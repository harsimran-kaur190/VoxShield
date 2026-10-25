/**
 * The recording lifecycle, independent of React and of the browser. Every browser API is injected through
 * `RecorderEnv`, so the rules that matter (the microphone is released, nothing starts without a click, a recording
 * is never uploaded from here) can be tested without a microphone.
 */

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'processing' | 'ready' | 'error'
export type RecorderErrorCode = 'unsupported' | 'denied' | 'no_device' | 'busy' | 'empty' | 'decode' | 'too_short' | 'interrupted' | 'failed'

export interface RecorderError {
  code: RecorderErrorCode
  message: string
}

export interface RecordingResult {
  blob: Blob
  url: string
  duration: number
  peaks: number[]
  /** True when the microphone stopped on its own and this is only what was captured before that. */
  interrupted: boolean
}

export interface RecorderSnapshot {
  status: RecorderStatus
  elapsed: number
  levels: number[]
  error: RecorderError | null
  result: RecordingResult | null
}

export interface RecorderLike {
  state: string
  start(timeslice?: number): void
  stop(): void
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: (() => void) | null
}

export interface LevelMeter {
  /** Current microphone level from 0 to 1. */
  read(): number
  close(): void
}

export interface RecorderEnv {
  supported(): boolean
  getUserMedia(): Promise<MediaStream>
  mimeType(): string
  createRecorder(stream: MediaStream, mimeType: string): RecorderLike
  createMeter(stream: MediaStream): LevelMeter
  toWav(blob: Blob): Promise<{ wav: Blob; duration: number; peaks: number[] }>
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
  now(): number
  setInterval(callback: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export interface RecorderLimits {
  maxSeconds: number
  minSeconds: number
}

export const LEVEL_BARS = 96
export const TICK_MS = 50

const MESSAGES: Record<RecorderErrorCode, string> = {
  unsupported: 'Recording is not available in this browser. It needs microphone support and a secure page (https or localhost). You can still upload a file.',
  denied: 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.',
  no_device: 'No microphone was found. Connect one, check your system sound settings, then try again.',
  busy: 'The microphone could not be started. Another app may be using it.',
  empty: 'Nothing was recorded. Check that the right microphone is selected, then try again.',
  decode: 'This browser recorded audio it could not read back. Try again, or upload a file instead.',
  too_short: 'That recording was too short to analyze.',
  interrupted: 'The microphone stopped before anything usable was recorded.',
  failed: 'The recording could not be started. Try again, or upload a file instead.',
}

export const recorderError = (code: RecorderErrorCode, message = MESSAGES[code]): RecorderError => ({ code, message })

/** Map a getUserMedia failure to a message a person can act on. */
export function describeMicError(error: unknown): RecorderError {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return recorderError('denied')
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return recorderError('no_device')
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return recorderError('busy')
  return recorderError('failed')
}

const CANDIDATE_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']

/** First container this browser can actually record, or '' to let the browser choose. */
export function pickMimeType(isTypeSupported: ((type: string) => boolean) | undefined): string {
  if (!isTypeSupported) return ''
  return CANDIDATE_TYPES.find((type) => isTypeSupported(type)) ?? ''
}

const INITIAL: RecorderSnapshot = { status: 'idle', elapsed: 0, levels: [], error: null, result: null }

export class RecorderSession {
  private snapshot: RecorderSnapshot = INITIAL
  private listeners = new Set<() => void>()
  private stream: MediaStream | null = null
  private recorder: RecorderLike | null = null
  private meter: LevelMeter | null = null
  private timer: unknown = null
  private chunks: Blob[] = []
  private startedAt = 0
  private mime = ''
  private interrupted = false
  private finalizing = false
  private detached = false
  /** Bumped by discard and detach so that late async work from an older recording is ignored. */
  private generation = 0

  private readonly env: RecorderEnv
  private limits: RecorderLimits

  constructor(env: RecorderEnv, limits: RecorderLimits) {
    this.env = env
    this.limits = limits
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  configure(limits: RecorderLimits) {
    this.limits = limits
  }

  /** Mark the session in use. Returns the function that releases everything (React may mount, unmount and remount). */
  attach() {
    this.detached = false
    return () => this.release(true)
  }

  private set(patch: Partial<RecorderSnapshot>) {
    if (this.detached) return
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  /** Begins a recording. Only ever called from a user action; this is also where the permission prompt appears. */
  async start() {
    const { status } = this.snapshot
    if (status === 'requesting' || status === 'recording' || status === 'processing') return // no duplicate streams
    if (!this.env.supported()) {
      this.set({ status: 'error', error: recorderError('unsupported'), result: null })
      return
    }
    this.revokeResult()
    const generation = ++this.generation
    this.set({ status: 'requesting', error: null, result: null, elapsed: 0, levels: [] })

    let stream: MediaStream
    try {
      stream = await this.env.getUserMedia()
    } catch (error) {
      if (generation === this.generation) this.set({ status: 'error', error: describeMicError(error) })
      return
    }
    if (generation !== this.generation || this.detached) {
      stopTracks(stream) // the user left or discarded while the permission prompt was open
      return
    }

    try {
      this.stream = stream
      this.mime = this.env.mimeType()
      this.chunks = []
      this.interrupted = false
      this.finalizing = false
      const recorder = this.env.createRecorder(stream, this.mime)
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) this.chunks.push(event.data)
      }
      recorder.onstop = () => void this.finalize(generation)
      recorder.onerror = () => this.interrupt(generation)
      for (const track of stream.getAudioTracks()) track.onended = () => this.interrupt(generation)
      this.meter = this.env.createMeter(stream)
      this.recorder = recorder
      recorder.start(250)
    } catch {
      this.release(false)
      this.set({ status: 'error', error: recorderError('failed') })
      return
    }
    this.startedAt = this.env.now()
    this.timer = this.env.setInterval(() => this.tick(), TICK_MS)
    this.set({ status: 'recording' })
  }

  stop() {
    if (this.snapshot.status !== 'recording') return
    const generation = this.generation
    this.set({ status: 'processing' })
    this.stopTicking()
    try {
      this.recorder?.stop() // the final chunk arrives, then onstop runs finalize
    } catch {
      void this.finalize(generation)
    }
  }

  /** Throws the recording away and releases the microphone. */
  discard() {
    this.release(false)
    this.revokeResult()
    this.set({ ...INITIAL })
  }

  private tick() {
    if (this.snapshot.status !== 'recording' || !this.meter) return
    const elapsed = (this.env.now() - this.startedAt) / 1000
    const levels = [...this.snapshot.levels.slice(-(LEVEL_BARS - 1)), this.meter.read()]
    this.set({ elapsed, levels })
    if (elapsed >= this.limits.maxSeconds) this.stop()
  }

  private interrupt(generation: number) {
    if (generation !== this.generation || this.snapshot.status !== 'recording') return
    this.interrupted = true
    this.stop()
  }

  private async finalize(generation: number) {
    if (generation !== this.generation || this.finalizing) return
    this.finalizing = true
    this.stopTicking()
    this.closeMeter()
    stopTracks(this.stream) // the microphone is released as soon as recording ends, before any conversion
    this.stream = null
    this.recorder = null
    const interrupted = this.interrupted
    const blob = new Blob(this.chunks, { type: this.mime || 'audio/webm' })
    this.chunks = []
    const fail = (code: RecorderErrorCode) => this.set({ status: 'error', error: recorderError(interrupted ? 'interrupted' : code) })

    if (blob.size === 0) return fail('empty')
    let converted: Awaited<ReturnType<RecorderEnv['toWav']>>
    try {
      converted = await this.env.toWav(blob)
    } catch {
      if (generation === this.generation) fail('decode')
      return
    }
    if (generation !== this.generation) return
    if (converted.duration < this.limits.minSeconds) return fail('too_short')
    this.set({
      status: 'ready',
      error: null,
      result: {
        blob: converted.wav,
        url: this.env.createObjectURL(converted.wav),
        duration: converted.duration,
        peaks: converted.peaks,
        interrupted,
      },
    })
  }

  private stopTicking() {
    if (this.timer !== null) this.env.clearInterval(this.timer)
    this.timer = null
  }

  private closeMeter() {
    this.meter?.close()
    this.meter = null
  }

  private revokeResult() {
    if (this.snapshot.result) this.env.revokeObjectURL(this.snapshot.result.url)
  }

  /** Stop the timer, the level meter, the recorder and every microphone track. */
  private release(markDetached: boolean) {
    this.generation++
    this.stopTicking()
    this.closeMeter()
    if (this.recorder) {
      this.recorder.ondataavailable = null
      this.recorder.onstop = null
      this.recorder.onerror = null
      try {
        if (this.recorder.state !== 'inactive') this.recorder.stop()
      } catch {
        // already stopped
      }
    }
    this.recorder = null
    stopTracks(this.stream)
    this.stream = null
    this.chunks = []
    if (markDetached) {
      this.revokeResult()
      this.detached = true
    }
  }
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

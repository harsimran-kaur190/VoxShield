/**
 * Playback of the analyzed recording, independent of React. The browser's audio element and URL functions are
 * injected so the rules (one object URL at a time, always revoked; nothing plays after release; the playhead
 * follows the real element) can be tested without a browser.
 *
 * The audio is the user's own file or recording held in memory for this results view. It is never uploaded here.
 */

export interface AudioLike {
  src: string
  currentTime: number
  duration: number
  paused: boolean
  ended: boolean
  volume: number
  muted: boolean
  play(): Promise<void>
  pause(): void
  load(): void
  removeAttribute(name: string): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

export interface AudioEnv {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
  requestFrame(callback: () => void): unknown
  cancelFrame(handle: unknown): void
}

/** unavailable: there is no audio in this session. error: the browser could not load or play it. */
export type PlaybackStatus = 'unavailable' | 'loading' | 'ready' | 'error'

export interface PlaybackState {
  status: PlaybackStatus
  playing: boolean
  duration: number
  volume: number
  muted: boolean
  error: string | null
}

const EVENTS = ['loadedmetadata', 'durationchange', 'canplay', 'play', 'playing', 'pause', 'ended', 'error', 'volumechange', 'timeupdate', 'seeked'] as const

const finitePositive = (value: number) => Number.isFinite(value) && value > 0

export class AudioController {
  private readonly env: AudioEnv
  private readonly fallbackDuration: number
  private audio: AudioLike | null = null
  private url: string | null = null
  private source: Blob | null = null
  private frame: unknown = null
  private state: PlaybackState
  private time = 0
  private stateListeners = new Set<() => void>()
  private timeListeners = new Set<() => void>()
  private readonly onEvent = (): void => this.sync()
  private readonly onFailure = (): void => this.fail('This browser could not play the recording.')

  constructor(env: AudioEnv, fallbackDuration: number) {
    this.env = env
    this.fallbackDuration = fallbackDuration
    this.state = { status: 'unavailable', playing: false, duration: fallbackDuration, volume: 1, muted: false, error: null }
  }

  subscribe = (listener: () => void) => {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }
  getState = () => this.state

  /** The playhead has its own channel so a 60 fps update does not re-render everything that reads the state. */
  subscribeTime = (listener: () => void) => {
    this.timeListeners.add(listener)
    return () => this.timeListeners.delete(listener)
  }
  getTime = () => this.time

  /** Attach the audio element. Returns a function that detaches it and stops all listeners and frames. */
  bind(audio: AudioLike): () => void {
    this.audio = audio
    for (const type of EVENTS) audio.addEventListener(type, type === 'error' ? this.onFailure : this.onEvent)
    this.applySource()
    return () => {
      this.stopFrames()
      for (const type of EVENTS) audio.removeEventListener(type, type === 'error' ? this.onFailure : this.onEvent)
      if (this.audio === audio) this.audio = null
    }
  }

  /** Use this recording (or none). Any previous object URL is revoked first. */
  setSource(blob: Blob | null): void {
    this.source = blob
    this.applySource()
  }

  /** Stop playback and release the audio and its object URL. */
  release(): void {
    this.source = null
    this.stopFrames()
    this.audio?.pause()
    this.applySource()
  }

  async play(): Promise<void> {
    const { audio } = this
    if (!audio || this.state.status === 'unavailable' || this.state.status === 'error') return
    try {
      await audio.play()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return // a pause or a new load interrupted it
      this.fail('Playback could not start. Press play again.')
    }
  }

  pause(): void {
    this.audio?.pause()
  }

  toggle(): void {
    if (this.state.playing) this.pause()
    else void this.play()
  }

  /** Move the playhead. Out-of-range requests are clamped; nothing happens when there is no usable audio. */
  seek(seconds: number): void {
    const { audio } = this
    if (!audio || !Number.isFinite(seconds) || this.state.status === 'unavailable' || this.state.status === 'error') return
    const target = Math.min(Math.max(seconds, 0), this.state.duration)
    audio.currentTime = target
    this.setTime(target)
  }

  skip(delta: number): void {
    this.seek(this.time + delta)
  }

  setVolume(volume: number): void {
    if (!this.audio) return
    this.audio.volume = Math.min(Math.max(volume, 0), 1)
    if (volume > 0) this.audio.muted = false
    this.sync()
  }

  toggleMute(): void {
    if (!this.audio) return
    this.audio.muted = !this.audio.muted
    this.sync()
  }

  // ---- internals ----

  private applySource(): void {
    if (this.url) this.env.revokeObjectURL(this.url)
    this.url = null
    this.setTime(0)
    const { audio, source } = this
    if (!audio) {
      this.patch({ status: source ? 'loading' : 'unavailable', playing: false, error: null })
      return
    }
    audio.pause()
    if (!source) {
      audio.removeAttribute('src')
      audio.load()
      this.patch({ status: 'unavailable', playing: false, duration: this.fallbackDuration, error: null })
      return
    }
    this.url = this.env.createObjectURL(source)
    audio.src = this.url
    audio.load()
    this.patch({ status: 'loading', playing: false, duration: this.fallbackDuration, error: null })
  }

  private sync(): void {
    const { audio } = this
    if (!audio || !this.source) return
    const playing = !audio.paused && !audio.ended
    const metadata = finitePositive(audio.duration)
    this.patch({
      status: this.state.status === 'error' ? 'error' : metadata || this.state.status === 'ready' ? 'ready' : 'loading',
      playing,
      duration: metadata ? audio.duration : this.fallbackDuration,
      volume: audio.volume,
      muted: audio.muted,
    })
    this.setTime(audio.currentTime)
    if (playing) this.startFrames()
    else this.stopFrames()
  }

  private fail(message: string): void {
    this.stopFrames()
    this.patch({ status: 'error', playing: false, error: message })
  }

  private startFrames(): void {
    if (this.frame !== null) return
    const tick = () => {
      this.frame = null
      if (!this.audio || this.audio.paused) return
      this.setTime(this.audio.currentTime)
      this.frame = this.env.requestFrame(tick)
    }
    this.frame = this.env.requestFrame(tick)
  }

  private stopFrames(): void {
    if (this.frame !== null) this.env.cancelFrame(this.frame)
    this.frame = null
  }

  private patch(change: Partial<PlaybackState>): void {
    const next = { ...this.state, ...change }
    if ((Object.keys(next) as (keyof PlaybackState)[]).every((key) => next[key] === this.state[key])) return
    this.state = next
    this.stateListeners.forEach((listener) => listener())
  }

  private setTime(seconds: number): void {
    if (seconds === this.time) return
    this.time = seconds
    this.timeListeners.forEach((listener) => listener())
  }
}

export const browserAudioEnv: AudioEnv = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle as number),
}

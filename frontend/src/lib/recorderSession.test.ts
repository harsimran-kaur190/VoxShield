import { describe, expect, it, vi } from 'vitest'

import {
  describeMicError,
  pickMimeType,
  RecorderSession,
  type RecorderEnv,
  type RecorderLike,
} from './recorderSession'
import { recorderLimits, recordingFileName, recordingToFile } from './recording'

class FakeTrack {
  stopped = false
  onended: (() => void) | null = null
  stop() {
    this.stopped = true
  }
}

class FakeRecorder implements RecorderLike {
  state = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  private readonly emit: Blob[]
  constructor(emit: Blob[]) {
    this.emit = emit
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.emit.forEach((data) => this.ondataavailable?.({ data }))
    this.onstop?.()
  }
}

function setup(options: { chunks?: Blob[]; duration?: number; getUserMedia?: () => Promise<MediaStream>; toWavError?: boolean; supported?: boolean } = {}) {
  const track = new FakeTrack()
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream
  let clock = 0
  let tick: (() => void) | null = null
  const meter = { read: vi.fn(() => 0.5), close: vi.fn() }
  const revoked: string[] = []
  const recorders: FakeRecorder[] = []
  const getUserMedia = vi.fn(options.getUserMedia ?? (async () => stream))
  const env: RecorderEnv = {
    supported: () => options.supported ?? true,
    getUserMedia,
    mimeType: () => 'audio/webm;codecs=opus',
    createRecorder: () => {
      const recorder = new FakeRecorder(options.chunks ?? [new Blob(['audio-bytes'])])
      recorders.push(recorder)
      return recorder
    },
    createMeter: () => meter,
    toWav: async () => {
      if (options.toWavError) throw new Error('cannot decode')
      return { wav: new Blob(['RIFF....WAVE'], { type: 'audio/wav' }), duration: options.duration ?? 5, peaks: [0.1, 0.5, 1] }
    },
    createObjectURL: () => `blob:fake-${recorders.length}`,
    revokeObjectURL: (url) => revoked.push(url),
    now: () => clock,
    setInterval: (callback) => {
      tick = callback
      return 1
    },
    clearInterval: () => {
      tick = null
    },
  }
  const session = new RecorderSession(env, { maxSeconds: 10, minSeconds: 1 })
  session.attach()
  return {
    session,
    track,
    meter,
    revoked,
    getUserMedia,
    recorders,
    advance: (seconds: number) => {
      clock += seconds * 1000
      tick?.()
    },
    timerRunning: () => tick !== null,
    status: () => session.getSnapshot().status,
  }
}

describe('RecorderSession', () => {
  it('does nothing until start is called: no microphone request, no recorder', () => {
    const t = setup()
    expect(t.status()).toBe('idle')
    expect(t.getUserMedia).not.toHaveBeenCalled()
    expect(t.recorders).toHaveLength(0)
  })

  it('starts recording and reports elapsed time and real meter levels', async () => {
    const t = setup()
    await t.session.start()
    expect(t.status()).toBe('recording')
    t.advance(2)
    const snap = t.session.getSnapshot()
    expect(snap.elapsed).toBe(2)
    expect(snap.levels).toEqual([0.5])
    expect(t.meter.read).toHaveBeenCalled()
  })

  it('stop produces a ready WAV result and releases the microphone, the meter and the timer', async () => {
    const t = setup()
    await t.session.start()
    t.advance(3)
    t.session.stop()
    await vi.waitFor(() => expect(t.status()).toBe('ready'))
    const result = t.session.getSnapshot().result
    expect(result?.blob.type).toBe('audio/wav')
    expect(result?.url).toMatch(/^blob:/)
    expect(result?.interrupted).toBe(false)
    expect(t.track.stopped).toBe(true)
    expect(t.meter.close).toHaveBeenCalled()
    expect(t.timerRunning()).toBe(false)
  })

  it('ignores a second start while a recording or permission request is in progress (no duplicate streams)', async () => {
    const t = setup()
    const first = t.session.start()
    await t.session.start() // while still requesting
    await first
    await t.session.start() // while recording
    expect(t.getUserMedia).toHaveBeenCalledTimes(1)
    expect(t.recorders).toHaveLength(1)
  })

  it('stops automatically at the maximum duration', async () => {
    const t = setup()
    await t.session.start()
    t.advance(10)
    expect(['processing', 'ready']).toContain(t.status())
    await vi.waitFor(() => expect(t.status()).toBe('ready'))
    expect(t.track.stopped).toBe(true)
  })

  describe('failures', () => {
    it.each([
      ['NotAllowedError', 'denied'],
      ['NotFoundError', 'no_device'],
      ['NotReadableError', 'busy'],
      ['SomethingElse', 'failed'],
    ])('maps a %s from the microphone request to %s and records nothing', async (name, code) => {
      const t = setup({ getUserMedia: async () => Promise.reject(Object.assign(new Error('x'), { name })) })
      await t.session.start()
      expect(t.session.getSnapshot()).toMatchObject({ status: 'error', error: { code } })
      expect(t.recorders).toHaveLength(0)
    })

    it('can try again after a denial', async () => {
      let denied = true
      const t = setup({ getUserMedia: async () => (denied ? Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' })) : ({ getTracks: () => [], getAudioTracks: () => [] } as unknown as MediaStream)) })
      await t.session.start()
      expect(t.status()).toBe('error')
      denied = false
      await t.session.start()
      expect(t.status()).toBe('recording')
    })

    it('reports an unsupported browser without asking for the microphone', async () => {
      const t = setup({ supported: false })
      await t.session.start()
      expect(t.session.getSnapshot().error?.code).toBe('unsupported')
      expect(t.getUserMedia).not.toHaveBeenCalled()
    })

    it('reports an empty recording and still releases the microphone', async () => {
      const t = setup({ chunks: [] })
      await t.session.start()
      t.session.stop()
      await vi.waitFor(() => expect(t.status()).toBe('error'))
      expect(t.session.getSnapshot().error?.code).toBe('empty')
      expect(t.track.stopped).toBe(true)
    })

    it('reports audio the browser cannot decode', async () => {
      const t = setup({ toWavError: true })
      await t.session.start()
      t.session.stop()
      await vi.waitFor(() => expect(t.status()).toBe('error'))
      expect(t.session.getSnapshot().error?.code).toBe('decode')
    })

    it('rejects a recording shorter than the minimum', async () => {
      const t = setup({ duration: 0.4 })
      await t.session.start()
      t.session.stop()
      await vi.waitFor(() => expect(t.status()).toBe('error'))
      expect(t.session.getSnapshot().error?.code).toBe('too_short')
    })

    it('keeps what was captured when the microphone disappears mid-recording, and says so', async () => {
      const t = setup()
      await t.session.start()
      t.advance(2)
      t.track.onended?.()
      await vi.waitFor(() => expect(t.status()).toBe('ready'))
      expect(t.session.getSnapshot().result?.interrupted).toBe(true)
    })

    it('reports an interruption when nothing usable was captured', async () => {
      const t = setup({ chunks: [] })
      await t.session.start()
      t.track.onended?.()
      await vi.waitFor(() => expect(t.status()).toBe('error'))
      expect(t.session.getSnapshot().error?.code).toBe('interrupted')
    })
  })

  describe('discard, record again, and cleanup', () => {
    it('discard returns to idle, revokes the preview URL, and holds no microphone', async () => {
      const t = setup()
      await t.session.start()
      t.session.stop()
      await vi.waitFor(() => expect(t.status()).toBe('ready'))
      const url = t.session.getSnapshot().result?.url as string
      t.session.discard()
      expect(t.session.getSnapshot()).toMatchObject({ status: 'idle', result: null, error: null, elapsed: 0 })
      expect(t.revoked).toContain(url)
    })

    it('discarding mid-recording stops the tracks and the timer and never produces a result', async () => {
      const t = setup()
      await t.session.start()
      t.session.discard()
      expect(t.track.stopped).toBe(true)
      expect(t.meter.close).toHaveBeenCalled()
      expect(t.timerRunning()).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(t.status()).toBe('idle')
    })

    it('record again after a result revokes the old preview and starts a fresh recording', async () => {
      const t = setup()
      await t.session.start()
      t.session.stop()
      await vi.waitFor(() => expect(t.status()).toBe('ready'))
      const old = t.session.getSnapshot().result?.url as string
      await t.session.start()
      expect(t.status()).toBe('recording')
      expect(t.revoked).toContain(old)
      expect(t.session.getSnapshot().result).toBeNull()
    })

    it('releasing (unmount) while recording stops every track and the timer', async () => {
      const t = setup()
      const release = t.session.attach()
      await t.session.start()
      release()
      expect(t.track.stopped).toBe(true)
      expect(t.timerRunning()).toBe(false)
    })

    it('leaving while the permission prompt is open releases the stream as soon as it is granted', async () => {
      let grant: (stream: MediaStream) => void = () => {}
      const t = setup({ getUserMedia: () => new Promise((resolve) => (grant = resolve)) })
      const release = t.session.attach()
      const started = t.session.start()
      release()
      grant({ getTracks: () => [t.track], getAudioTracks: () => [t.track] } as unknown as MediaStream)
      await started
      expect(t.track.stopped).toBe(true)
      expect(t.recorders).toHaveLength(0)
    })
  })
})

describe('describeMicError', () => {
  it('gives every failure a message a person can act on', () => {
    for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'Other']) {
      expect(describeMicError({ name }).message.length).toBeGreaterThan(20)
    }
    expect(describeMicError(null).code).toBe('failed')
  })
})

describe('pickMimeType', () => {
  it('chooses the first container the browser says it supports instead of assuming one', () => {
    expect(pickMimeType((type) => type.startsWith('audio/mp4'))).toBe('audio/mp4')
    expect(pickMimeType((type) => type === 'audio/ogg;codecs=opus')).toBe('audio/ogg;codecs=opus')
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus')
  })

  it('falls back to the browser default when nothing is reported as supported', () => {
    expect(pickMimeType(() => false)).toBe('')
    expect(pickMimeType(undefined)).toBe('')
  })
})

describe('recording limits and files', () => {
  it('caps the recording at the backend duration limit', () => {
    const limits = recorderLimits({ max_upload_mb: 25, min_duration_seconds: 1, max_duration_seconds: 600, allowed_extensions: ['.wav'] })
    expect(limits).toEqual({ maxSeconds: 600, minSeconds: 1 })
  })

  it('caps the recording so the WAV always fits the upload size limit', () => {
    const { maxSeconds } = recorderLimits({ max_upload_mb: 5, min_duration_seconds: 1, max_duration_seconds: 600, allowed_extensions: ['.wav'] })
    expect(maxSeconds * 32_000 + 44).toBeLessThan(5 * 1024 * 1024)
    expect(maxSeconds).toBeLessThan(600)
  })

  it('uses the documented defaults before the limits have loaded', () => {
    expect(recorderLimits(null)).toEqual({ maxSeconds: 600, minSeconds: 1 })
  })

  it('names the file as a timestamped .wav that the existing upload validation accepts', () => {
    expect(recordingFileName(new Date(2026, 9, 25, 14, 5, 9))).toBe('recording-20261025-140509.wav')
    const file = recordingToFile({ blob: new Blob(['x'], { type: 'audio/wav' }) }, new Date(2026, 9, 25, 14, 5, 9))
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('audio/wav')
    expect(file.name.endsWith('.wav')).toBe(true)
  })
})

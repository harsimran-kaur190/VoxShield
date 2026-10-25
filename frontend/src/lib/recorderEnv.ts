import { computePeaks } from './waveform'
import { encodeWav } from './wav'
import { pickMimeType, type LevelMeter, type RecorderEnv, type RecorderLike } from './recorderSession'

/** The analysis backend works on 16 kHz mono, so that is what the recording is converted to. */
export const TARGET_SAMPLE_RATE = 16_000

type AudioContextCtor = typeof AudioContext

function audioContextCtor(): AudioContextCtor | undefined {
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
}

/**
 * Browsers record different containers (WebM in Chrome, MP4 in Safari, Ogg in Firefox), and the backend does not accept
 * WebM. So the recording is decoded here and re-encoded as a 16-bit PCM WAV, which every browser can produce and the
 * backend already accepts.
 */
async function toWav(blob: Blob) {
  const Ctor = audioContextCtor()
  if (!Ctor) throw new Error('no audio context')
  const context = new Ctor()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE))
    const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE) // mono and 16 kHz: downmix and resample
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const samples = (await offline.startRendering()).getChannelData(0)
    return { wav: encodeWav(samples, TARGET_SAMPLE_RATE), duration: samples.length / TARGET_SAMPLE_RATE, peaks: computePeaks(samples, 160) }
  } finally {
    void context.close().catch(() => undefined)
  }
}

function createMeter(stream: MediaStream): LevelMeter {
  const Ctor = audioContextCtor()
  if (!Ctor) throw new Error('no audio context')
  const context = new Ctor()
  void context.resume().catch(() => undefined)
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser) // never connected to the speakers, so there is no feedback
  const data = new Float32Array(analyser.fftSize)
  return {
    read() {
      analyser.getFloatTimeDomainData(data)
      let peak = 0
      for (const value of data) peak = Math.max(peak, Math.abs(value))
      return Math.min(1, Math.sqrt(peak)) // square root so quiet speech is still visible
    },
    close() {
      source.disconnect()
      void context.close().catch(() => undefined)
    },
  }
}

export function browserRecorderEnv(): RecorderEnv {
  return {
    supported: () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined' && !!audioContextCtor(),
    // Browser voice processing would change the audio the voice model hears, so it is asked to stay off.
    getUserMedia: () =>
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }),
    mimeType: () => pickMimeType(MediaRecorder.isTypeSupported?.bind(MediaRecorder)),
    createRecorder: (stream, mimeType) => new MediaRecorder(stream, mimeType ? { mimeType } : undefined) as unknown as RecorderLike,
    createMeter,
    toWav,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    now: () => performance.now(),
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
  }
}

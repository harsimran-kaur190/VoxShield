export interface Waveform {
  peaks: number[]
  duration: number
}

/** Reduce samples to `buckets` normalized peak values (0 to 1). */
export function computePeaks(samples: Float32Array, buckets: number): number[] {
  if (samples.length === 0 || buckets <= 0) return []
  const size = Math.max(1, Math.floor(samples.length / buckets))
  const peaks: number[] = []
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = bucket * size
    if (start >= samples.length) break
    const end = bucket === buckets - 1 ? samples.length : Math.min(start + size, samples.length)
    let max = 0
    for (let i = start; i < end; i++) {
      const value = Math.abs(samples[i])
      if (value > max) max = value
    }
    peaks.push(max)
  }
  const top = peaks.reduce((a, b) => Math.max(a, b), 0)
  return top > 0 ? peaks.map((peak) => peak / top) : peaks
}

type AudioContextCtor = typeof AudioContext

/**
 * Decode the selected file in the browser to draw its real waveform. Only the peak values are kept; the audio never
 * leaves the browser here. Returns null when this browser cannot decode the format.
 */
export async function decodeWaveform(file: File, buckets = 240): Promise<Waveform | null> {
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
  if (!Ctor) return null
  let context: AudioContext | null = null
  try {
    // Peaks do not need CD quality. Decoding at 8 kHz keeps a 10-minute recording to a few MB instead of hundreds.
    try {
      context = new Ctor({ sampleRate: 8000 })
    } catch {
      context = new Ctor()
    }
    const buffer = await context.decodeAudioData(await file.arrayBuffer())
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => computePeaks(buffer.getChannelData(i), buckets))
    const peaks = channels[0].map((_, i) => Math.max(...channels.map((channel) => channel[i] ?? 0)))
    return { peaks, duration: buffer.duration }
  } catch {
    return null
  } finally {
    void context?.close().catch(() => undefined)
  }
}

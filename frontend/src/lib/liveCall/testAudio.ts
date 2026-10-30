/**
 * Test audio for the own-voice check. Not speech: a deterministic stand-in for one person talking (noise shaped into
 * syllables and pauses of random length), so two seeds give two different "voices" with independent rhythms.
 */

export const RATE = 16_000

export function syntheticVoice(seed: number, seconds: number): Float32Array {
  let state = seed >>> 0 || 1
  const random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32
  const out = new Float32Array(Math.round(seconds * RATE))
  let i = 0
  while (i < out.length) {
    const syllable = Math.round((0.08 + random() * 0.22) * RATE)
    const pause = Math.round((0.03 + random() * (random() < 0.2 ? 0.4 : 0.08)) * RATE)
    const peak = 0.1 + random() * 0.25
    for (let k = 0; k < syllable && i < out.length; k++, i++) out[i] = (random() * 2 - 1) * peak * Math.sin((Math.PI * k) / syllable)
    i += pause
  }
  return out
}

/** `signal` arriving `ms` later and at `gain`, as through a call (the start is silence). */
export function delayed(signal: Float32Array, ms: number, gain = 1): Float32Array {
  const shift = Math.round((ms / 1000) * RATE)
  const out = new Float32Array(signal.length)
  for (let i = shift; i < out.length; i++) out[i] = signal[i - shift] * gain
  return out
}

export function silence(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * RATE))
}

/** 16-bit PCM frames of `seconds` each, as the capture produces them. */
export function frames(signal: Float32Array, seconds: number): ArrayBuffer[] {
  const size = Math.round(seconds * RATE)
  const out: ArrayBuffer[] = []
  for (let start = 0; start + size <= signal.length; start += size) {
    const frame = new Int16Array(size)
    for (let i = 0; i < size; i++) frame[i] = Math.max(-1, Math.min(1, signal[start + i])) * 0x7fff
    out.push(frame.buffer)
  }
  return out
}

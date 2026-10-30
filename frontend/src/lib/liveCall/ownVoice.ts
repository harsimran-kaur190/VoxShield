/**
 * Recognises the listener's own voice coming back in the other person's audio.
 *
 * When both participants share one microphone (two tabs on one computer), or the other person's microphone picks up
 * their speakers, the audio this browser receives contains what this listener just said. Sent for analysis, it would
 * be transcribed and alerted as the other person's speech. Such audio follows the local microphone closely, a short
 * network delay later; the other person's own speech does not. The comparison uses loudness envelopes (10 ms steps),
 * which survive the codec, echo cancellation and different gains.
 *
 * Over a second or less, two unrelated voices can line up by chance, so the decision rests on a few seconds: each
 * incoming frame is held until the next one arrives (at the start of a call, until two seconds have arrived), then
 * judged on the incoming audio around it. Only a clear match is silenced; mixed or unclear audio (both people talking)
 * is passed on, so the other person's speech is never lost.
 */

const BIN = 160 // samples per envelope step: 10 ms at 16 kHz
const BIN_MS = 10
/** How much later than the microphone the same sound can arrive in the incoming audio. */
const MAX_LAG_MS = 1000
/** Incoming audio compared with the microphone at once, and the least of it needed to decide. */
const WINDOW_MS = 3000
const MIN_WINDOW_MS = 2000
const KEEP_LOCAL_MS = WINDOW_MS + MAX_LAG_MS + 1000
/** Below this level (RMS, 0 to 1) there is no speech: the incoming audio of a call still connecting. */
const MIN_LEVEL = 0.01
/** Envelope correlation from which the incoming audio counts as a copy of the microphone. Unrelated voices stay well
 * below it over WINDOW_MS. */
const MATCH = 0.85
/** The microphone must be at least this loud, relative to the incoming audio, while they match. */
const MIN_LOCAL_RATIO = 0.3
/** Share of the window that must have microphone audio to compare against. */
const MIN_COVERAGE = 0.9
/** Frames held at most while waiting for MIN_WINDOW_MS of incoming audio. */
const MAX_HELD = 3

export function envelope(frame: ArrayBuffer): Float32Array {
  const samples = new Int16Array(frame)
  const out = new Float32Array(Math.floor(samples.length / BIN))
  for (let b = 0; b < out.length; b++) {
    let sum = 0
    for (let i = b * BIN; i < (b + 1) * BIN; i++) sum += (samples[i] / 32768) ** 2
    out[b] = Math.sqrt(sum / BIN)
  }
  return out
}

function correlation(a: Float32Array, b: Float32Array): number {
  const n = a.length
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let ab = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < n; i++) {
    ab += (a[i] - ma) * (b[i] - mb)
    aa += (a[i] - ma) ** 2
    bb += (b[i] - mb) ** 2
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0
}

const mean = (values: Float32Array) => values.reduce((sum, v) => sum + v, 0) / (values.length || 1)

/** The last few seconds of one audio stream's envelope; its last step ended at `end` (ms). */
class Envelope {
  steps = new Float32Array(0)
  end = 0
  private readonly keep: number

  constructor(keepMs: number) {
    this.keep = keepMs / BIN_MS
  }

  push(steps: Float32Array, at: number) {
    // After a gap (a capture restarted), earlier audio is no longer contiguous with the new frame.
    const kept = this.steps.length && at - steps.length * BIN_MS - this.end < 250 ? this.steps : new Float32Array(0)
    const joined = new Float32Array(kept.length + steps.length)
    joined.set(kept)
    joined.set(steps, kept.length)
    this.steps = joined.slice(-this.keep)
    this.end = at
  }

  clear() {
    this.steps = new Float32Array(0)
  }
}

export class OwnVoiceGate {
  private local = new Envelope(KEEP_LOCAL_MS)
  private incoming = new Envelope(WINDOW_MS)
  private held: ArrayBuffer[] = []

  /** A frame of this listener's microphone audio that ended at `at` (ms). */
  pushLocal(frame: ArrayBuffer, at: number) {
    this.local.push(envelope(frame), at)
  }

  /**
   * Takes the incoming frame that ended at `at` (ms) and returns the earlier frames now judged, oldest first, ready to
   * send: unchanged, or as silence when they were this listener's own voice coming back.
   */
  next(frame: ArrayBuffer, at: number): { frame: ArrayBuffer; ownVoice: boolean }[] {
    let steps = envelope(frame)
    if (!this.incoming.steps.length) {
      // Until something arrives, the incoming audio is the silence of a call still connecting: not compared.
      const first = steps.findIndex((v) => v >= MIN_LEVEL)
      steps = first < 0 ? new Float32Array(0) : steps.subarray(first)
    }
    if (steps.length) this.incoming.push(steps, at)
    this.held.push(frame)
    if (this.held.length < 2 || (this.incoming.steps.length < MIN_WINDOW_MS / BIN_MS && this.held.length < MAX_HELD)) return []
    const ready = this.held.slice(0, -1)
    this.held = this.held.slice(-1)
    const ownVoice = this.matchesMicrophone()
    return ready.map((held) => ({ frame: ownVoice ? new ArrayBuffer(held.byteLength) : held, ownVoice }))
  }

  /** Whether the recent incoming audio is a delayed copy of the microphone. */
  private matchesMicrophone(): boolean {
    const remote = this.incoming.steps
    const local = this.local.steps
    const n = remote.length
    if (n < MIN_WINDOW_MS / BIN_MS || !local.length) return false
    // Index in the microphone envelope of the step at the same moment as the last incoming step.
    const end = local.length - 1 - Math.round((this.local.end - this.incoming.end) / BIN_MS)
    for (let lag = 0; lag <= MAX_LAG_MS / BIN_MS; lag++) {
      const start = end - lag - (n - 1)
      const first = Math.max(start, 0) // older microphone audio is not kept
      const last = Math.min(end - lag, local.length - 1) // newer microphone audio has not arrived yet
      if (last < first + n * MIN_COVERAGE - 1) continue
      const mine = local.subarray(first, last + 1)
      const theirs = remote.subarray(first - start, last - start + 1)
      if (mean(mine) >= MIN_LOCAL_RATIO * mean(theirs) && correlation(mine, theirs) >= MATCH) return true
    }
    return false
  }

  /** The incoming audio stopped (the other person left or reconnected): forget it, and drop the frames held. */
  resetIncoming() {
    this.incoming.clear()
    this.held = []
  }

  clear() {
    this.local.clear()
    this.resetIncoming()
  }
}

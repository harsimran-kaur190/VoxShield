import { describe, expect, it } from 'vitest'

import { OwnVoiceGate } from './ownVoice'
import { delayed, frames, silence, syntheticVoice } from './testAudio'

// Synthetic signals only (see testAudio.ts): these test the comparison, not any speech or scam model.

/** Feeds `mic` and `incoming` the way a call does (100 ms microphone frames, 1 s incoming frames) and returns what is
 * released for sending, in order, next to the frame it came from. */
function run(mic: Float32Array, incoming: Float32Array) {
  const gate = new OwnVoiceGate()
  const micFrames = frames(mic, 0.1)
  const inputs = frames(incoming, 1)
  const sent = inputs.flatMap((frame, k) => {
    for (let m = k * 10; m < (k + 1) * 10; m++) gate.pushLocal(micFrames[m], (m + 1) * 100)
    return gate.next(frame, (k + 1) * 1000)
  })
  return sent.map((output, k) => ({ input: inputs[k], ...output }))
}

const isSilent = (frame: ArrayBuffer) => new Int16Array(frame).every((v) => v === 0)

describe('own-voice check', () => {
  it('silences the listener’s own voice coming back, from the first second of the call', () => {
    const me = syntheticVoice(1, 20)
    for (const lagMs of [40, 150, 600, 900]) {
      const sent = run(me, delayed(me, lagMs, 0.5))
      expect(sent.length, `lag ${lagMs} ms`).toBe(19) // every frame but the last, still held
      expect(sent.every((s) => s.ownVoice && isSilent(s.frame)), `lag ${lagMs} ms`).toBe(true)
    }
  })

  it('never touches the other person’s speech, even while the listener talks over them', () => {
    const me = syntheticVoice(1, 60)
    for (const seed of [2, 3, 4, 5, 6, 7, 8, 9]) {
      const sent = run(me, delayed(syntheticVoice(seed, 60), 150))
      expect(sent.filter((s) => s.ownVoice), `voice ${seed}`).toEqual([])
      expect(sent.every((s) => s.frame === s.input)).toBe(true) // passed on untouched
    }
  })

  it('does nothing while the listener is silent or muted', () => {
    const sent = run(silence(10), syntheticVoice(2, 10))
    expect(sent.some((s) => s.ownVoice)).toBe(false)
  })

  it('keeps the other person’s speech when it is mixed with the listener’s echo', () => {
    // Echo of the listener at half level under the other person's voice: unclear, so it is passed on.
    const me = syntheticVoice(1, 20)
    const echo = delayed(me, 150, 0.5)
    const them = syntheticVoice(3, 20)
    const sent = run(me, them.map((v, i) => v + echo[i]))
    expect(sent.some((s) => s.ownVoice)).toBe(false)
  })

  it('switches with the turns: the listener’s echo is silenced, the other person’s reply is kept', () => {
    // 0–8 s: only the listener talks (their echo comes back). 8–16 s: only the other person talks.
    const me = syntheticVoice(1, 16).map((v, i) => (i < 8 * 16000 ? v : 0))
    const them = syntheticVoice(5, 16).map((v, i) => (i >= 8 * 16000 ? v : 0))
    const echo = delayed(me, 150, 0.6)
    const sent = run(me, them.map((v, i) => v + echo[i]))
    const ownVoice = sent.map((s) => s.ownVoice)
    expect(ownVoice.slice(0, 7).every(Boolean)).toBe(true)
    expect(ownVoice.slice(8).some(Boolean)).toBe(false)
  })
})

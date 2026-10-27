import { describe, expect, it } from 'vitest'

import { FAKE_SCORE_NAME, formatFakeScore, scaleOffset, splitVoiceSummary, VOICE_READING } from './score'

describe('formatFakeScore', () => {
  it.each([
    [0.82, '82%'],
    [0.5, '50%'],
    [0.07, '7%'],
    [0.924, '92%'],
    [0.0, '<1%'],
    [0.004, '<1%'],
    [0.995, '>99%'],
    [1, '>99%'],
  ])('%s is shown as %s', (score, shown) => {
    expect(formatFakeScore(score)).toBe(shown)
  })

  it('never shows a missing or invalid score as a number', () => {
    for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatFakeScore(bad)).toBe('—')
  })

  it('keeps out-of-range model output on the scale', () => {
    expect(formatFakeScore(1.4)).toBe('>99%')
    expect(formatFakeScore(-0.2)).toBe('<1%')
    expect(scaleOffset(1.4)).toBe('100%')
    expect(scaleOffset(-1)).toBe('0%')
    expect(scaleOffset(Number.NaN)).toBe('0%')
    expect(scaleOffset(0.25)).toBe('25%')
  })

  it('is named a label score, never a probability or a chance', () => {
    expect(FAKE_SCORE_NAME).toBe('fake-label score')
    expect(FAKE_SCORE_NAME).not.toMatch(/probab|chance|likelihood|deepfake/i)
  })
})

describe('VOICE_READING', () => {
  it('has a reading for every verdict, and none claims proof, a probability, or a scam conclusion', () => {
    expect(Object.keys(VOICE_READING).sort()).toEqual(['inconclusive', 'model_favors_fake', 'model_favors_real', 'unavailable'])
    for (const text of Object.values(VOICE_READING)) expect(text).not.toMatch(/\d\s?%|probab|\bproves?\b|\bis a scam\b|\bis fake\b/i)
    expect(VOICE_READING.model_favors_fake).toMatch(/nothing about whether the words are a scam/)
    expect(VOICE_READING.model_favors_real).toMatch(/not confirmation/)
  })
})

describe('splitVoiceSummary', () => {
  it('moves only the exact known spot-check sentence out of the summary', () => {
    const full = "The model's 'fake' label won in 3 of 3 windows. On phone-quality audio it did the same for a few real voices in VoxShield's benchmark."
    expect(splitVoiceSummary(full)).toEqual({ lead: "The model's 'fake' label won in 3 of 3 windows.", aside: "On phone-quality audio it did the same for a few real voices in VoxShield's benchmark." })
  })

  it('returns any other summary whole, so wording is never lost', () => {
    for (const text of ["The model's 'real' label won in 2 of 2 windows.", 'Something new the backend now says. It did the same elsewhere.', '']) {
      expect(splitVoiceSummary(text)).toEqual({ lead: text, aside: null })
    }
  })
})

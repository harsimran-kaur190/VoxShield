import { describe, expect, it } from 'vitest'

import { findingCaveats, findingSource, hasUsableTiming, sharedFindingNotes } from './evidence'

describe('evidence helpers', () => {
  it('accepts only real, ordered segment times', () => {
    expect(hasUsableTiming({ start_seconds: 1, end_seconds: 2 })).toBe(true)
    expect(hasUsableTiming({ start_seconds: Number.NaN, end_seconds: 2 })).toBe(false)
    expect(hasUsableTiming({ start_seconds: 3, end_seconds: 2 })).toBe(false)
    expect(hasUsableTiming({ start_seconds: -1, end_seconds: 2 })).toBe(false)
  })

  it('names the detector that produced a finding and never the voice analysis', () => {
    expect(findingSource({ detector: 'nli' })).toContain('language model')
    expect(findingSource({ detector: 'rules' })).toContain('fixed text rules')
  })

  it('lists a caution for one finding only when it applies to that finding', () => {
    expect(findingCaveats({ context: 'direct' }, undefined)).toEqual([])
    expect(findingCaveats({ context: 'direct' }, { avg_logprob: -0.3 })).toEqual([])
    expect(findingCaveats({ context: 'reported' }, { avg_logprob: null }).join(' ')).toContain('quoted or recounted')
    expect(findingCaveats({ context: 'direct' }, { avg_logprob: -1.6 }).join(' ')).toContain('low-confidence')
  })

  it('says what is true of every finding once, by detector, without repeating it per finding', () => {
    const model = sharedFindingNotes('nli').join(' ')
    expect(model).toContain('not the chance that a scam occurred')
    expect(model).toContain('depend on the transcript being correct')
    expect(sharedFindingNotes('rules').join(' ')).toContain('cannot tell whether the speaker meant it')
    for (const notes of [sharedFindingNotes('nli'), sharedFindingNotes('rules')]) expect(notes.join(' ')).not.toMatch(/not proof/i)
  })
})

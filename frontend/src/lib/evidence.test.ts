import { describe, expect, it } from 'vitest'

import { findingCaveats, findingSource, hasUsableTiming } from './evidence'

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

  it('adds reported-speech and score caveats only when they apply', () => {
    const direct = findingCaveats({ detector: 'rules', context: 'direct', score: null }, undefined)
    expect(direct.join(' ')).not.toContain('quoted')
    const reported = findingCaveats({ detector: 'nli', context: 'reported', score: 0.9 }, { avg_logprob: null })
    expect(reported.join(' ')).toContain('quoted or recounted')
    expect(reported.join(' ')).toContain('not the chance')
  })
})

import { describe, expect, it } from 'vitest'

import { basisOf, nextStep } from './actions'
import type { Recommendation, RecommendationPlan } from './types'

const rec = (overrides: Partial<Recommendation> = {}): Recommendation => ({
  id: 'credentials',
  title: 'Do not share codes',
  detail: 'd',
  priority: 'high',
  evidence: [],
  secondary: false,
  ...overrides,
})
const plan = (overrides: Partial<RecommendationPlan> = {}): RecommendationPlan => ({ state: 'actions', headline: 'h', detail: null, items: [rec()], ...overrides })

describe('nextStep', () => {
  it('shows the first action the server ranked and counts the rest, without re-ranking', () => {
    const step = nextStep(plan({ items: [rec({ id: 'a', title: 'First' }), rec({ id: 'b', title: 'Second', priority: 'high' }), rec({ id: 'c' })] }))
    expect(step).toMatchObject({ kind: 'action', more: 2 })
    expect(step.kind === 'action' && step.item.title).toBe('First')
  })

  it('carries the plan headline for a voice-only action, because there is no scam finding to cite', () => {
    const step = nextStep(plan({ headline: 'Voice leaned fake', items: [rec({ id: 'voice', basis: 'voice' })] }))
    expect(step.kind === 'action' && step.headline).toBe('Voice leaned fake')
    const scam = nextStep(plan())
    expect(scam.kind === 'action' && scam.headline).toBeNull()
  })

  it('offers a general precaution, labelled as general, when nothing specific was found', () => {
    const general = rec({ id: 'general_verify', basis: 'general' })
    const step = nextStep(plan({ state: 'none_detected', items: [], general: [general] }))
    expect(step).toMatchObject({ kind: 'none', canRetry: false })
    expect(step.kind === 'none' && step.general?.id).toBe('general_verify')
  })

  it('allows a retry only when there was not enough evidence, and invents nothing when there is none', () => {
    const step = nextStep(plan({ state: 'insufficient', items: [] }))
    expect(step).toMatchObject({ kind: 'none', canRetry: true, general: null })
  })

  it('treats a report from an older server (no basis, no general list) as finding-based advice', () => {
    expect(basisOf(rec())).toBe('finding')
    expect(nextStep(plan({ state: 'none_detected', items: [] }))).toMatchObject({ kind: 'none', general: null })
  })
})

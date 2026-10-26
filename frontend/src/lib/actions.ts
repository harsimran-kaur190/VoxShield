import type { Recommendation, RecommendationBasis, RecommendationPlan } from './types'

export const BASIS_LABEL: Record<RecommendationBasis, string> = {
  finding: 'From a finding in this recording',
  voice: 'From the voice model only. This is not a scam finding',
  general: 'General precaution. Not a result of this analysis',
}

/** Older reports have no basis; their advice always came from a scam finding. */
export const basisOf = (rec: Recommendation): RecommendationBasis => rec.basis ?? 'finding'

export type NextStep =
  /** The single most relevant action. `more` counts the other actions listed further down. */
  | { kind: 'action'; item: Recommendation; more: number; headline: string | null }
  /** Nothing specific to do. `general` is an ordinary precaution, labelled as such, when one applies. */
  | { kind: 'none'; headline: string; detail: string | null; general: Recommendation | null; canRetry: boolean }

/**
 * What to show under "What should I do next?". The backend has already ordered the plan (advice that follows from a
 * scam finding first, then by priority), so the first action is the one shown; nothing is re-ranked or invented here.
 */
export function nextStep(plan: RecommendationPlan): NextStep {
  const [first, ...rest] = plan.items
  if (plan.state === 'actions' && first) {
    // A voice-only plan has no scam finding to cite, so its own headline carries the explanation.
    return { kind: 'action', item: first, more: rest.length, headline: basisOf(first) === 'voice' ? plan.headline : null }
  }
  return { kind: 'none', headline: plan.headline, detail: plan.detail, general: plan.general?.[0] ?? null, canRetry: plan.state === 'insufficient' }
}

import type { BadgeTone } from '../components/ui/styles'

/**
 * Bands for a 0–100 scam-intent score. The score is an estimate of how strongly the words match scam patterns, not the
 * probability that a caller is a criminal, and the thresholds are display conventions, not calibrated cut-offs.
 * The backend does not produce this score; today only the simulated demo uses it.
 */

export type ScamIntentBandId = 'low' | 'moderate' | 'high' | 'critical'

export interface ScamIntentBand {
  id: ScamIntentBandId
  label: string
  tone: BadgeTone
  /** Stroke class for the score ring, and fill class for a status dot. */
  stroke: string
  dot: string
  summary: string
}

const BANDS: Record<ScamIntentBandId, ScamIntentBand> = {
  low: { id: 'low', label: 'Low', tone: 'neutral', stroke: 'stroke-ink-3', dot: 'bg-ink-3', summary: 'Few or no scam patterns in what was said so far. That does not make the call safe.' },
  moderate: { id: 'moderate', label: 'Moderate', tone: 'warning', stroke: 'stroke-amber-light', dot: 'bg-amber-light', summary: 'Some patterns often seen in scams. Worth slowing down and checking.' },
  high: { id: 'high', label: 'High', tone: 'warning', stroke: 'stroke-amber', dot: 'bg-amber', summary: 'Several patterns often seen in scams. Verify the caller before doing anything they ask.' },
  critical: {
    id: 'critical',
    label: 'Critical',
    tone: 'critical',
    stroke: 'stroke-critical',
    dot: 'bg-critical',
    summary: 'Strong, quoted evidence of patterns typical of payment scams. Do not act on the request without independent verification.',
  },
}

export const BAND_THRESHOLDS = { moderate: 25, high: 50, critical: 75 } as const

/**
 * The band for a score. Red ("critical") needs both a high score and at least one piece of quoted evidence, so a
 * number on its own can never produce the strongest warning.
 */
export function scamIntentBand(score: number, evidenceCount: number): ScamIntentBand {
  const value = Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0
  if (value >= BAND_THRESHOLDS.critical) return evidenceCount > 0 ? BANDS.critical : BANDS.high
  if (value >= BAND_THRESHOLDS.high) return BANDS.high
  if (value >= BAND_THRESHOLDS.moderate) return BANDS.moderate
  return BANDS.low
}

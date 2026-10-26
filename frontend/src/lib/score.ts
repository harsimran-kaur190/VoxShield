import type { VoiceVerdict } from './types'

/** What the voice number is called wherever it is shown. It is a model output, never the chance that a voice is fake. */
export const FAKE_SCORE_NAME = 'fake-label score'

/**
 * A normalized 0 to 1 model score as a percentage, for display only. The extremes are shown as "<1%" and ">99%" so a
 * rounded 100% never reads as certainty. Missing or non-numeric input is shown as a dash, never as 0%.
 */
export function formatFakeScore(score: number | null | undefined): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—'
  const percent = Math.min(1, Math.max(0, score)) * 100
  if (percent < 1) return '<1%'
  if (percent > 99) return '>99%'
  return `${Math.round(percent)}%`
}

/** Left offset on a 0 to 100% scale, clamped so a marker can never leave the scale. */
export function scaleOffset(score: number): string {
  const clamped = Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0
  return `${clamped * 100}%`
}

/**
 * One plain sentence on what the backend's own decision means. It repeats the backend's verdict and adds no threshold,
 * accuracy, or confidence of its own.
 */
export const VOICE_READING: Record<VoiceVerdict, string> = {
  model_favors_real: 'By its own decision rule the model leans toward its “real” label for this audio. That is a model reading, not confirmation that the voice is genuine.',
  model_favors_fake: 'By its own decision rule the model leans toward its “fake” label for this audio. That does not show the recording was generated, and it says nothing about whether the words are a scam.',
  inconclusive: 'The windows disagreed or sat close to the middle, so the model does not lean either way.',
  unavailable: 'The voice check could not run, so there is no voice result.',
}

/** The backend's summary ends with this exact sentence when the model leans "fake"; it refers to the exploratory spot check. */
const SPOT_CHECK_ASIDE = " It did the same for some real recordings in VoxShield's spot check."

/**
 * Separates that one known sentence from the rest of the backend summary, so the spot-check detail can sit with the
 * other methodology. Only an exact match moves; any other summary is returned whole, so no wording is ever lost.
 */
export function splitVoiceSummary(summary: string): { lead: string; aside: string | null } {
  return summary.endsWith(SPOT_CHECK_ASIDE) ? { lead: summary.slice(0, -SPOT_CHECK_ASIDE.length), aside: SPOT_CHECK_ASIDE.trim() } : { lead: summary, aside: null }
}

import type { IntentRisk, VoiceVerdict } from './types'

export const VOICE_VIEW: Record<VoiceVerdict, { label: string; dot: string }> = {
  model_favors_fake: { label: 'Model favors “fake”', dot: 'bg-amber-light' },
  model_favors_real: { label: 'Model favors “real”', dot: 'bg-accent' },
  inconclusive: { label: 'Inconclusive', dot: 'bg-line-strong' },
  unavailable: { label: 'Unavailable', dot: 'bg-ink-3' },
}

export const INTENT_VIEW: Record<IntentRisk, { label: string; dot: string }> = {
  high: { label: 'Strong indicators', dot: 'bg-critical' },
  elevated: { label: 'Notable indicators', dot: 'bg-amber-light' },
  weak_signals: { label: 'Weak signals only', dot: 'bg-accent' },
  none_detected: { label: 'No indicators found', dot: 'bg-line-strong' },
  inconclusive: { label: 'Inconclusive', dot: 'bg-line-strong' },
  unavailable: { label: 'Unavailable', dot: 'bg-ink-3' },
}

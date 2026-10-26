import type { IntentIndicator, TranscriptSegment } from './types'

/** Whisper's own rule of thumb treats a segment average log-probability below this as unreliable speech recognition. */
export const LOW_TRANSCRIPTION_CONFIDENCE = -1

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** A segment can drive seeking only when its start and end are real, ordered times. */
export function hasUsableTiming(segment: Pick<TranscriptSegment, 'start_seconds' | 'end_seconds'>): boolean {
  return finite(segment.start_seconds) && finite(segment.end_seconds) && segment.start_seconds >= 0 && segment.end_seconds >= segment.start_seconds
}

/** Where a finding came from, in plain words. Only describes stages that actually produced it. */
export function findingSource(indicator: Pick<IntentIndicator, 'detector'>): string {
  return indicator.detector === 'nli'
    ? 'Scam-intent analysis (language model) of the speech-to-text transcript. The voice analysis was not used.'
    : 'Scam-intent analysis (fixed text rules) of the speech-to-text transcript. The voice analysis was not used.'
}

/** Limits that apply to this specific finding, taken from what the detector and transcriber actually reported. */
export function findingCaveats(
  indicator: Pick<IntentIndicator, 'detector' | 'context' | 'score'>,
  segment: Pick<TranscriptSegment, 'avg_logprob'> | undefined,
): string[] {
  const notes: string[] = []
  if (indicator.detector === 'nli' && indicator.score !== null) {
    notes.push('The model score measures how strongly the sentence matches a scam-style statement. It is not the chance that a scam occurred.')
  } else if (indicator.detector === 'rules') {
    notes.push('A fixed wording rule matched. It cannot tell whether the speaker meant it.')
  }
  if (indicator.context === 'reported') notes.push('The wording appears to be quoted or recounted, so it may not have been said to you.')
  if (segment && finite(segment.avg_logprob) && segment.avg_logprob < LOW_TRANSCRIPTION_CONFIDENCE) {
    notes.push('Speech recognition was low-confidence for this part, so the transcript wording may be wrong.')
  }
  notes.push('Depends on the transcript being correct.')
  return notes
}

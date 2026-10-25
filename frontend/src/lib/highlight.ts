import type { IntentIndicator, TranscriptSegment } from './types'

/** Same value the backend sends as `id`; computed so older reports without it still link up. */
export const indicatorKey = (indicator: IntentIndicator) => indicator.id || `${indicator.rule_id}-${indicator.char_start}`

export interface Piece {
  text: string
  /** Keys of every indicator covering this text. Empty for plain transcript text. */
  keys: string[]
}

/**
 * Split one transcript segment into pieces so that only text a rule actually matched is marked.
 * Overlapping matches are kept: a piece lists every indicator that covers it.
 */
export function buildPieces(segment: TranscriptSegment, indicators: IntentIndicator[]): Piece[] {
  const spans = indicators
    .map((indicator) => ({
      key: indicatorKey(indicator),
      start: Math.max(indicator.char_start, segment.char_start) - segment.char_start,
      end: Math.min(indicator.char_end, segment.char_end) - segment.char_start,
    }))
    .filter((span) => span.end > span.start)
  const cuts = [...new Set([0, segment.text.length, ...spans.flatMap((span) => [span.start, span.end])])]
    .filter((cut) => cut >= 0 && cut <= segment.text.length)
    .sort((a, b) => a - b)
  const pieces: Piece[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const [from, to] = [cuts[i], cuts[i + 1]]
    const keys = spans.filter((span) => span.start <= from && span.end >= to).map((span) => span.key)
    pieces.push({ text: segment.text.slice(from, to), keys })
  }
  return pieces
}

/** The transcript segment an indicator belongs to, or undefined when it could not be located. */
export function segmentOf(indicator: IntentIndicator, segments: TranscriptSegment[]) {
  return segments.find((segment) => segment.index === indicator.segment_index)
}

export const CATEGORY_LABELS: Record<string, string> = {
  credential_request: 'Asks for a code or secret',
  payment_pressure: 'Payment request',
  impersonation: 'Claimed identity',
  coercion_threat: 'Threat or alarm',
  urgency: 'Time pressure',
  secrecy_isolation: 'Secrecy',
  verification_bypass: 'Discourages checking',
  remote_access: 'Remote access request',
}

export const formatTimestamp = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

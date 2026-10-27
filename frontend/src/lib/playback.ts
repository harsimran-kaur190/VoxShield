import { indicatorKey } from './highlight'
import { formatTimestamp } from './highlight'
import type { EvidenceRef, IntentIndicator, TranscriptSegment } from './types'

const SEVERITY_RANK = { high: 2, medium: 1, low: 0 } as const

/** The segment being spoken at `time`, or null in a gap, before the first segment, or after the last. */
export function activeSegmentIndex(segments: TranscriptSegment[], time: number): number | null {
  const found = segments.find((segment) => time >= segment.start_seconds && time < segment.end_seconds)
  return found ? found.index : null
}

/** Where a finding can be heard. Only a real timestamp from the pipeline counts; there is no fallback position. */
export function findingSeekTime(indicator: Pick<IntentIndicator, 'start_seconds'>): number | null {
  const value = indicator.start_seconds
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export interface FindingGroup {
  /** Every indicator id in the group; any of them selects it. */
  ids: string[]
  key: string
  excerpt: string
  charStart: number
  start_seconds: number | null
  end_seconds: number | null
  severity: IntentIndicator['severity']
  context: IntentIndicator['context']
  items: IntentIndicator[]
}

/**
 * One entry per quoted passage. The language model can flag the same sentence for several behaviors, and showing the
 * sentence once with its reasons is clearer than repeating it. Strongest first, direct before reported; nothing is
 * dropped.
 */
export function groupFindings(indicators: IntentIndicator[]): FindingGroup[] {
  const byPassage = new Map<string, IntentIndicator[]>()
  for (const item of indicators) {
    // Offsets into the transcript and into its translation are different texts, so they never share a passage.
    const passage = `${item.text_source ?? 'transcript'}:${item.char_start}:${item.char_end}`
    byPassage.set(passage, [...(byPassage.get(passage) ?? []), item])
  }
  const groups = [...byPassage.values()].map((items): FindingGroup => {
    const sorted = [...items].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    const first = sorted[0]
    return {
      ids: sorted.map(indicatorKey),
      key: indicatorKey(first),
      excerpt: first.excerpt,
      charStart: first.char_start,
      start_seconds: findingSeekTime(first) === null ? null : first.start_seconds,
      end_seconds: first.end_seconds,
      severity: first.severity,
      context: sorted.some((i) => i.context === 'direct') ? 'direct' : 'reported',
      items: sorted,
    }
  })
  return groups.sort(
    (a, b) =>
      Number(b.context === 'direct') - Number(a.context === 'direct') ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.charStart - b.charStart,
  )
}

export function positionLabel(seconds: number, duration: number): string {
  return `${formatTimestamp(seconds)} of ${formatTimestamp(duration)}`
}

/** Two findings on one sentence trigger the same advice; show that passage once. */
export function uniqueEvidence(evidence: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>()
  return evidence.filter((item) => {
    const key = `${item.source}|${item.label}|${item.start_seconds}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

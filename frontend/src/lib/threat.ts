import { findingSource } from './evidence'
import { CATEGORY_LABELS, indicatorKey } from './highlight'
import { findingSeekTime } from './playback'
import type { AnalysisReport } from './types'

/**
 * The threat alert for a real analysis, derived only from the backend's scam-intent result. The voice verdict is never
 * an input: a "fake" lean is not evidence of a scam, and a "real" lean is not evidence of safety.
 *
 * - critical (red): the backend rated the risk "high" and quoted at least one direct request from the transcript.
 * - caution (amber): the backend rated the risk "elevated" and quoted at least one direct request.
 * - otherwise no alert; the overview shows the inconclusive, weak or unavailable result as it is.
 */

export type ThreatLevel = 'critical' | 'caution'

export interface ThreatAlert {
  level: ThreatLevel
  /** Human-readable scam categories from the quoted indicators, in order of first appearance. */
  categories: string[]
  /** Up to three quoted excerpts, strongest first, each with its real timestamp when the backend gave one. */
  excerpts: { key: string; text: string; start_seconds: number | null; translated: boolean }[]
  /** The backend's own one-line summary of the intent result. */
  reason: string
  /** Titles of the backend's recommendations that follow from findings. */
  actions: string[]
  /** Which detector read which text, so a rules match is not presented as a model judgement. */
  source: string
}

const SEVERITY = { high: 2, medium: 1, low: 0 } as const

export const categoryLabel = (category: string) => CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ')

export function threatAlert(report: AnalysisReport): ThreatAlert | null {
  const { intent } = report
  if (report.status === 'failed' || (intent.risk !== 'high' && intent.risk !== 'elevated')) return null
  const direct = intent.indicators.filter((item) => item.context === 'direct')
  if (direct.length === 0) return null

  const ranked = [...direct].sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || (a.start_seconds ?? Infinity) - (b.start_seconds ?? Infinity))
  const seen = new Set<string>()
  const excerpts: ThreatAlert['excerpts'] = []
  for (const item of ranked) {
    const text = item.excerpt.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    excerpts.push({ key: indicatorKey(item), text, start_seconds: findingSeekTime(item), translated: item.text_source === 'translation' })
    if (excerpts.length === 3) break
  }

  const categories = [...new Set(direct.map((item) => categoryLabel(item.category)))]
  const actions = report.recommendations.items.filter((item) => (item.basis ?? 'finding') === 'finding').map((item) => item.title)

  return { level: intent.risk === 'high' ? 'critical' : 'caution', categories, excerpts, reason: intent.summary, actions: actions.slice(0, 3), source: findingSource(intent) }
}

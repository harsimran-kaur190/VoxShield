import { AlertOctagon, AlertTriangle, ArrowRight } from 'lucide-react'

import { formatTimestamp } from '../../lib/highlight'
import type { ThreatAlert } from '../../lib/threat'

const LEVEL = {
  critical: { title: 'Threat alert: strong scam-intent indicators', box: 'border-critical/30 bg-critical-tint', text: 'text-critical', icon: AlertOctagon },
  caution: { title: 'Caution: notable scam-intent indicators', box: 'border-amber-light/50 bg-amber-tint/50', text: 'text-amber', icon: AlertTriangle },
} as const

interface Props {
  alert: ThreatAlert
  /** Absent in a static report, where the evidence is further down the same page. */
  onReviewEvidence?: () => void
  /**
   * A short banner for the results view, where the excerpt, the next step and the method notes follow directly below.
   * The standalone report shows the full alert.
   */
  compact?: boolean
}

/** The alert for a real analysis. Everything in it is taken from the backend's scam-intent result; the voice result is not used. */
export function ThreatAlertPanel({ alert, onReviewEvidence, compact = false }: Props) {
  const level = LEVEL[alert.level]
  const Icon = level.icon
  return (
    <section role="alert" aria-labelledby="threat-heading" className={`rounded-card border p-5 ${level.box}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-5 shrink-0 ${level.text}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="threat-heading" className={`font-semibold ${level.text}`}>
            {level.title}
          </h2>
          {!compact && <p className="mt-1 text-sm text-ink-2">{alert.reason}</p>}

          {alert.categories.length > 0 && (
            <p className="mt-3 text-sm text-ink">
              <span className="font-medium">Indicators: </span>
              {alert.categories.join(' · ')}
            </p>
          )}

          {!compact && (
            <ul className="mt-3 space-y-1.5">
              {alert.excerpts.map((excerpt) => (
                <li key={excerpt.key} className="border-l-2 border-line-strong pl-3 text-sm italic text-ink">
                  “{excerpt.text}”
                  {excerpt.start_seconds !== null && <span className="ml-2 font-mono text-xs not-italic text-ink-3">{formatTimestamp(excerpt.start_seconds)}</span>}
                  {excerpt.translated && <span className="ml-2 text-xs not-italic text-ink-3">(from the English translation)</span>}
                </li>
              ))}
            </ul>
          )}

          {!compact && alert.actions.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium text-ink">Protective steps</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-2">
                {alert.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-xs text-ink-3">
            {compact ? 'Based on what was said. The voice result did not raise this alert.' : `${alert.source} This alert is about what was said. It is not based on the voice result, and it is not proof of a scam.`}
          </p>
          {onReviewEvidence && (
            <button type="button" onClick={onReviewEvidence} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline pointer-coarse:min-h-11">
              Review the evidence
              <ArrowRight className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

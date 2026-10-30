import { AudioWaveform, ChevronDown, ShieldAlert, TriangleAlert } from 'lucide-react'
import { useId, useState } from 'react'

import type { LiveAlert } from '../../lib/liveCall/types'
import { ALERT_TITLE, formatClock } from '../../lib/liveCall/view'
import { categoryLabel } from '../../lib/threat'
import { VOICE_VIEW } from '../../lib/views'
import { Badge } from '../ui/Badge'

const LOOK = {
  high: { box: 'border-critical/40 bg-critical-tint', icon: 'text-critical' },
  elevated: { box: 'border-amber-light/50 bg-amber-tint/50', icon: 'text-amber' },
  low: { box: 'border-accent-tint bg-accent-tint/30', icon: 'text-accent' },
  caution: { box: 'border-dashed border-line-strong bg-paper-2', icon: 'text-ink-2' },
} as const

const DETECTOR = { nli: 'language model', rules: 'keyword rules' } as const

/** One live alert. The summary stays short; "View evidence" opens the quoted sentences, actions and limits. */
export function AlertCard({ alert, defaultOpen = false }: { alert: LiveAlert; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const detailsId = useId()
  const look = { ...LOOK[alert.level], title: ALERT_TITLE[alert.level] }
  const Icon = alert.kind === 'voice' ? AudioWaveform : alert.level === 'high' ? ShieldAlert : TriangleAlert
  const first = alert.evidence[0]
  const voice = VOICE_VIEW[alert.voice.verdict]

  return (
    <article className={`rounded-card border p-4 ${look.box}`} aria-label={`${look.title} at ${formatClock(alert.call_time_seconds)}`}
      data-alert-kind={alert.kind}>
      <header className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-5 shrink-0 ${look.icon}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 className="font-semibold text-ink">{look.title}</h3>
            <p className="font-mono text-xs text-ink-3">
              said at {formatClock(alert.call_time_seconds)} · alerted {new Date(alert.created_at).toLocaleTimeString(undefined, { timeStyle: 'medium' })}
            </p>
          </div>
          <p className="mt-1 text-sm text-ink-2">{alert.reason}</p>
        </div>
      </header>

      {alert.tactics.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Detected tactics">
          {alert.tactics.map((tactic) => (
            <li key={tactic}>
              <Badge tone={alert.level === 'high' ? 'critical' : 'warning'}>{categoryLabel(tactic)}</Badge>
            </li>
          ))}
        </ul>
      )}

      {first && (
        <blockquote className="mt-3 border-l-2 border-line-strong pl-3 text-sm italic text-ink">
          “{first.sentence}”
        </blockquote>
      )}

      <dl className="mt-3 grid gap-1 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-ink-3">Synthetic-voice check (separate):</dt>
          <dd className="inline-flex items-center gap-1.5 text-ink-2">
            <span className={`size-2 rounded-full ${voice.dot}`} aria-hidden />
            {voice.label}
            {alert.voice.fake_score_median !== null && <span className="text-ink-3">· score {alert.voice.fake_score_median.toFixed(2)}, uncalibrated (not a probability)</span>}
          </dd>
        </div>
        {alert.actions[0] && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-3">Do now:</dt>
            <dd className="font-medium text-ink">{alert.actions[0]}</dd>
          </div>
        )}
      </dl>

      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen(!open)}
        className="mt-3 inline-flex items-center gap-1 rounded-control text-sm font-medium text-accent hover:text-accent-deep pointer-coarse:min-h-11"
      >
        <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        {open ? 'Hide evidence' : 'View evidence'}
      </button>

      {open && (
        <div id={detailsId} className="mt-3 space-y-4 border-t border-line pt-3 text-sm">
          {alert.evidence.length > 0 && (
            <section>
              <h4 className="font-semibold text-ink">What was said</h4>
              <ul className="mt-2 space-y-2">
                {alert.evidence.map((item, index) => (
                  <li key={index} className="rounded-control bg-card/70 p-3">
                    <p className="text-ink">“{item.sentence}”</p>
                    {item.original_text && <p className="mt-1 text-ink-3">Original speech: “{item.original_text}”</p>}
                    <p className="mt-1 text-ink-2">{item.explanation}</p>
                    <p className="mt-1 font-mono text-xs text-ink-3">
                      {categoryLabel(item.category)} · {item.severity} severity · {DETECTOR[item.detector]}
                      {item.score !== null && ` · entailment ${item.score.toFixed(2)} (not a probability)`}
                      {item.call_time_seconds !== null && ` · ${formatClock(item.call_time_seconds)}`}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="font-mono text-xs text-ink-3">
            Speaker: the other participant{alert.source_participant_id ? ` (ID ${alert.source_participant_id})` : ''} · window {formatClock(alert.window[0])}–{formatClock(alert.window[1])}
          </p>
          <section>
            <h4 className="font-semibold text-ink">Voice check</h4>
            <p className="mt-1 text-ink-2">{alert.voice.summary}</p>
            {alert.voice.caution && <p className="mt-1 text-ink-3">{alert.voice.caution}</p>}
          </section>
          {alert.actions.length > 0 && (
            <section>
              <h4 className="font-semibold text-ink">Recommended steps</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-2">
                {alert.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h4 className="font-semibold text-ink">Limits of this alert</h4>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-3">
              {alert.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </article>
  )
}

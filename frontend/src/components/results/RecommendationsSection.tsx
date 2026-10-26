import { RotateCcw } from 'lucide-react'

import { BASIS_LABEL, basisOf } from '../../lib/actions'
import { formatTimestamp } from '../../lib/highlight'
import { uniqueEvidence } from '../../lib/playback'
import type { EvidenceRef, Priority, Recommendation, RecommendationPlan } from '../../lib/types'

const PRIORITY: Record<Priority, { label: string; dot: string }> = {
  high: { label: 'High priority', dot: 'bg-amber-light' },
  medium: { label: 'Medium priority', dot: 'bg-accent-light' },
  low: { label: 'Lower priority', dot: 'bg-stage-muted' },
}

interface Props {
  plan: RecommendationPlan
  /** ids of findings that exist in this report, so a chip never points at nothing */
  knownFindings: Set<string>
  onSelectFinding: (id: string) => void
  onShowVoice: () => void
  onRetry?: () => void
}

type Handlers = Pick<Props, 'onSelectFinding' | 'onShowVoice'> & { known: Set<string> }

function Evidence({ item, known, onSelectFinding, onShowVoice }: { item: EvidenceRef } & Handlers) {
  const text = item.source === 'voice' ? item.label : `“${item.label}”${item.start_seconds !== null ? ` · ${formatTimestamp(item.start_seconds)}` : ''}`
  const target = item.source === 'voice' ? onShowVoice : item.id && known.has(item.id) ? () => onSelectFinding(item.id as string) : null
  const base = 'max-w-full truncate rounded-full border border-stage-line px-3 py-1 text-left text-sm'
  const tappable = 'pointer-coarse:py-3'
  return target ? (
    <button type="button" onClick={target} className={`${base} ${tappable} text-paper/90 hover:border-accent-light hover:text-white`}>
      {text}
    </button>
  ) : (
    <span className={`${base} inline-block text-paper/70`}>{text}</span>
  )
}

function Chips({ rec, ...handlers }: { rec: Recommendation } & Handlers) {
  if (rec.evidence.length === 0) return null
  return (
    <ul aria-label="Triggered by" className="mt-3 flex flex-wrap items-center gap-2">
      <li className="text-sm text-paper/70">Triggered by</li>
      {uniqueEvidence(rec.evidence).map((item, i) => (
        <li key={`${item.id ?? item.source}-${i}`} className="max-w-full">
          <Evidence item={item} {...handlers} />
        </li>
      ))}
    </ul>
  )
}

function Why({ rec, showWhy = true }: { rec: Recommendation; showWhy?: boolean }) {
  return (
    <div className="mt-2 max-w-3xl text-sm text-paper/70">
      {showWhy && rec.why && <p>Why: {rec.why}</p>}
      <p className="mt-0.5 font-mono text-xs">{BASIS_LABEL[basisOf(rec)]}</p>
    </div>
  )
}

function PriorityLabel({ priority }: { priority: Priority }) {
  const view = PRIORITY[priority]
  return (
    <p className="flex items-center gap-2 text-sm text-paper/70">
      <span className={`size-2 rounded-full ${view.dot}`} aria-hidden />
      {view.label}
    </p>
  )
}

function Compact({ rec, ...handlers }: { rec: Recommendation } & Handlers) {
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h4 className="font-medium">{rec.title}</h4>
        <PriorityLabel priority={rec.priority} />
      </div>
      <p className="mt-1 max-w-3xl text-sm text-paper/80">{rec.detail}</p>
      <Why rec={rec} />
      <Chips rec={rec} {...handlers} />
    </li>
  )
}

export function RecommendationsSection({ plan, knownFindings, onSelectFinding, onShowVoice, onRetry }: Props) {
  if (plan.state !== 'actions') {
    return (
      <section aria-labelledby="steps-heading" className="border-t border-line pt-8">
        <h2 id="steps-heading" className="font-display text-3xl font-medium">
          What to do next
        </h2>
        <p className="mt-4 max-w-2xl text-lg">{plan.headline}</p>
        {plan.detail && <p className="mt-2 max-w-2xl text-ink-2">{plan.detail}</p>}
        {(plan.general ?? []).map((rec) => (
          <div key={rec.id} className="mt-5 max-w-2xl border-l-2 border-line-strong pl-4">
            <h3 className="font-medium">{rec.title}</h3>
            <p className="mt-1 text-ink-2">{rec.detail}</p>
            <p className="mt-1 text-sm text-ink-3">{BASIS_LABEL[basisOf(rec)]}.</p>
          </div>
        ))}
        {plan.state === 'insufficient' && onRetry && (
          <button type="button" onClick={onRetry} className="mt-5 inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-sm hover:bg-paper-2">
            <RotateCcw className="size-4" aria-hidden />
            Analyze this recording again
          </button>
        )}
      </section>
    )
  }

  const [first, ...rest] = plan.items
  const visible = rest.filter((rec) => !rec.secondary)
  const more = rest.filter((rec) => rec.secondary)
  const handlers: Handlers = { known: knownFindings, onSelectFinding, onShowVoice }
  return (
    <section aria-labelledby="steps-heading" className="rounded-3xl bg-ink p-6 text-paper sm:p-9">
      <h2 id="steps-heading" className="font-display text-3xl font-medium">
        What to do next
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-paper/70">{plan.headline}</p>

      <div className="mt-7">
        <p className="font-mono text-sm text-amber-light">Do this first</p>
        <h3 className="mt-1 font-display text-3xl font-medium sm:text-4xl">{first.title}</h3>
        <div className="mt-2">
          <PriorityLabel priority={first.priority} />
        </div>
        <p className="mt-3 max-w-2xl text-lg text-paper/90">{first.detail}</p>
        <Why rec={first} showWhy={false} />
        <Chips rec={first} {...handlers} />
      </div>

      {visible.length > 0 && (
        <div className="mt-8 border-t border-stage-line pt-6">
          <h3 className="font-mono text-sm text-paper/70">Then</h3>
          <ul className="mt-4 divide-y divide-stage-line">
            {visible.map((rec) => (
              <Compact key={rec.id} rec={rec} {...handlers} />
            ))}
          </ul>
        </div>
      )}
      {(plan.general ?? []).map((rec) => (
        <div key={rec.id} className="mt-6 max-w-3xl border-t border-stage-line pt-5">
          <h3 className="font-medium">{rec.title}</h3>
          <p className="mt-1 text-sm text-paper/80">{rec.detail}</p>
          <p className="mt-1 font-mono text-xs text-paper/70">{BASIS_LABEL[basisOf(rec)]}</p>
        </div>
      ))}
      {more.length > 0 && (
        <details className="mt-6 border-t border-stage-line pt-5">
          <summary className="flex cursor-pointer items-center text-paper/90 underline-offset-4 hover:underline pointer-coarse:min-h-11">Also worth doing ({more.length})</summary>
          <ul className="mt-5 divide-y divide-stage-line">
            {more.map((rec) => (
              <Compact key={rec.id} rec={rec} {...handlers} />
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

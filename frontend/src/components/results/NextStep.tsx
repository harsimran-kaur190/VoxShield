import { RotateCcw } from 'lucide-react'

import { BASIS_LABEL, basisOf, nextStep } from '../../lib/actions'
import { formatTimestamp } from '../../lib/highlight'
import type { RecommendationPlan } from '../../lib/types'
import { scrollToId } from './scroll'

interface Props {
  plan: RecommendationPlan
  onRetry?: () => void
}

/** The one thing to do next, near the top. The full list, with every piece of evidence, stays in "What to do next". */
export function NextStep({ plan, onRetry }: Props) {
  const step = nextStep(plan)
  return (
    <section aria-labelledby="next-heading" className="border-l-2 border-ink pl-5 sm:pl-6">
      <h2 id="next-heading" className="font-mono text-sm text-ink-3">
        What should I do next?
      </h2>

      {step.kind === 'action' ? (
        <>
          <p className="mt-2 font-display text-2xl font-medium leading-snug sm:text-3xl">{step.item.title}</p>
          {step.headline && <p className="mt-2 max-w-2xl text-ink-2">{step.headline}</p>}
          {step.item.why && <p className="mt-2 max-w-2xl text-ink-2">{step.item.why}</p>}
          {step.item.evidence[0] && step.item.evidence[0].source === 'intent' && (
            <p className="mt-3 max-w-2xl border-l-2 border-amber-light pl-3 font-display italic text-ink">
              “{step.item.evidence[0].label}”
              {step.item.evidence[0].start_seconds !== null && <span className="ml-2 font-mono text-xs not-italic text-ink-3">{formatTimestamp(step.item.evidence[0].start_seconds)}</span>}
            </p>
          )}
          <p className="mt-3 text-sm text-ink-3">{BASIS_LABEL[basisOf(step.item)]}.</p>
          <button type="button" onClick={() => scrollToId('steps-heading')} className="mt-1 inline-flex items-center rounded text-sm text-accent underline underline-offset-4 hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 pointer-coarse:min-h-11">
            {step.more > 0 ? `See the full steps (${step.more} more)` : 'See the details'}
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 max-w-2xl text-lg">{step.headline}</p>
          {step.detail && <p className="mt-1 max-w-2xl text-sm text-ink-3">{step.detail}</p>}
          {step.general && (
            <div className="mt-4 max-w-2xl">
              <p className="font-medium">{step.general.title}</p>
              <p className="mt-1 text-ink-2">{step.general.detail}</p>
              <p className="mt-1 text-sm text-ink-3">{BASIS_LABEL.general}.</p>
            </div>
          )}
          {step.canRetry && onRetry && (
            <button type="button" onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-sm hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2">
              <RotateCcw className="size-4" aria-hidden />
              Analyze this recording again
            </button>
          )}
        </>
      )}
    </section>
  )
}

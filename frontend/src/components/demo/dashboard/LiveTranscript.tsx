import { AlertTriangle, FileText, Info } from 'lucide-react'

import { formatTimestamp } from '../../../lib/highlight'
import { segmentDomId, splitByEvidence, type DemoIndicator, type DemoSegment } from '../../../lib/demoScenario'
import { Badge } from '../../ui/Badge'
import { buttonClass } from '../../ui/styles'

interface Props {
  segments: DemoSegment[]
  indicators: DemoIndicator[]
  selectedEvidence: string | null
  onToggleEvidence: (id: string) => void
  /** The whole prewritten script is shown, not only what has played. */
  full: boolean
  canViewFull: boolean
  onToggleFull: () => void
}

/** The simulated transcript: timestamped lines, highlighted evidence, and the reason for each highlight on demand. */
export function LiveTranscript({ segments, indicators, selectedEvidence, onToggleEvidence, full, canViewFull, onToggleFull }: Props) {
  const label = (id: string) => indicators.find((indicator) => indicator.id === id)?.label ?? id
  return (
    <section aria-labelledby="transcript-heading" className="rounded-card border border-line bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 id="transcript-heading" className="font-semibold text-ink">
            {full ? 'Full transcript' : 'Live transcript'}
          </h2>
          <p className="text-xs text-ink-3">Prewritten simulation script, not speech recognition.</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button type="button" onClick={onToggleFull} disabled={!canViewFull} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            <FileText className="size-4" aria-hidden />
            {full ? 'Show Played Portion' : 'View Full Transcript'}
          </button>
          {!canViewFull && <p className="text-xs text-ink-3">Available when the simulation finishes or ends.</p>}
        </div>
      </div>

      {segments.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-3">Waiting for the simulated caller to speak…</p>
      ) : (
        <ol className="divide-y divide-line" aria-live={full ? undefined : 'polite'} aria-relevant="additions">
          {segments.map((segment) => {
            const open = segment.evidence.find((item) => item.id === selectedEvidence)
            return (
              <li key={segment.id} id={segmentDomId(segment.id)} className={`scroll-mt-24 px-5 py-4 transition-colors ${open ? 'bg-amber-tint/25' : ''}`}>
                <div className="flex gap-3">
                  <span className="mt-0.5 w-10 shrink-0 font-mono text-xs text-ink-3">{formatTimestamp(segment.start)}</span>
                  <p className="min-w-0 flex-1 leading-relaxed text-ink">
                    <span className="sr-only">Caller: </span>
                    {splitByEvidence(segment).map((part, i) =>
                      part.evidence ? (
                        // A span rather than a <button>: browsers render buttons as inline blocks, which would break the
                        // sentence apart on narrow screens. It keeps button semantics and keyboard support.
                        <span
                          key={i}
                          role="button"
                          tabIndex={0}
                          onClick={() => onToggleEvidence(part.evidence!.id)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return
                            event.preventDefault()
                            onToggleEvidence(part.evidence!.id)
                          }}
                          aria-expanded={selectedEvidence === part.evidence.id}
                          aria-controls={`why-${part.evidence.id}`}
                          className={`cursor-pointer rounded px-0.5 ring-1 transition-colors [box-decoration-break:clone] ${
                            selectedEvidence === part.evidence.id ? 'bg-amber-light/40 ring-amber' : 'bg-amber-tint ring-amber-light hover:bg-amber-light/30'
                          }`}
                        >
                          {part.text}
                          <span className="sr-only"> (flagged: {label(part.evidence.indicatorId)})</span>
                        </span>
                      ) : (
                        <span key={i}>{part.text}</span>
                      ),
                    )}
                  </p>
                  {segment.evidence.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onToggleEvidence(open ? open.id : segment.evidence[0].id)}
                      aria-label={`${segment.evidence.length} flagged phrase${segment.evidence.length > 1 ? 's' : ''} at ${formatTimestamp(segment.start)}. Show why.`}
                      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-amber-tint/70 px-2 text-xs font-medium text-amber ring-1 ring-inset ring-amber-light/40 hover:bg-amber-tint pointer-coarse:h-11"
                    >
                      <AlertTriangle className="size-3.5" aria-hidden />
                      {segment.evidence.length}
                    </button>
                  )}
                </div>
                {open && (
                  <div id={`why-${open.id}`} className="mt-3 rounded-control border border-amber-light/50 bg-card p-3 text-sm sm:ml-13">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="warning">{label(open.indicatorId)}</Badge>
                      <span className="font-mono text-[11px] uppercase tracking-wide text-ink-3">Simulated</span>
                    </div>
                    <p className="mt-2 text-ink">
                      <span className="font-medium">“{open.phrase}”</span>: {open.why}
                    </p>
                    <p className="mt-1 text-ink-2">{indicators.find((indicator) => indicator.id === open.indicatorId)?.explanation}</p>
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-3">
                      <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                      An illustrative indicator in a made-up scenario, not a finding about a real person.
                    </p>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

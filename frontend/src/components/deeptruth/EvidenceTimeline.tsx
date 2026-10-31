import { MODALITY_LABELS, timelineRows, type DeepTruthReport } from '../../lib/deeptruth'

/**
 * One time axis for the whole file. Each module that scored windows gets a row; flagged windows are drawn in the
 * critical tone and labelled, unflagged ones in a quiet tone, so where in the clip the suspicion lies is visible at
 * a glance and the same seconds line up across audio and (from Phase 4) video rows.
 */
export function EvidenceTimeline({ report }: { report: DeepTruthReport }) {
  const rows = timelineRows(report)
  if (rows.length === 0) return null
  // The video frames are analysed for at most the first minute, so every row shares the longest span any row covers.
  const total = Math.max(...rows.map((r) => Math.max(r.duration, r.windows.at(-1)?.end_seconds ?? 0)), 1)
  const ticks = Array.from({ length: 5 }, (_, i) => (total * i) / 4)
  return (
    <div>
      <ol className="space-y-3">
        {rows.map((row) => (
          <li key={`${row.module}-${row.label}`} className="grid grid-cols-[8rem_1fr] items-center gap-3 sm:grid-cols-[12rem_1fr]">
            <span className="text-sm text-ink-2">
              {MODALITY_LABELS[row.module]}
              <span className="block text-xs text-ink-3">{row.windows.filter((w) => w.flagged).length} of {row.windows.length} windows flagged</span>
            </span>
            <ul className="relative h-7 rounded-md bg-paper-2" aria-label={`${row.label} over time`}>
              {row.windows.map((w) => (
                <li
                  key={w.start_seconds}
                  title={`${w.start_seconds.toFixed(1)}–${w.end_seconds.toFixed(1)} s: score ${w.score.toFixed(2)}${w.flagged ? ', flagged' : ''}`}
                  className={`absolute inset-y-1 rounded-sm ${w.flagged ? 'bg-critical' : 'bg-accent-light/60'}`}
                  style={{ left: `${(w.start_seconds / total) * 100}%`, width: `calc(${((w.end_seconds - w.start_seconds) / total) * 100}% - 2px)` }}
                >
                  {w.flagged && <span className="sr-only">flagged</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <div className="mt-1 grid grid-cols-[8rem_1fr] gap-3 sm:grid-cols-[12rem_1fr]">
        <span />
        <div className="flex justify-between font-mono text-[10px] text-ink-3">
          {ticks.map((t) => (
            <span key={t}>{t.toFixed(t >= 10 ? 0 : 1)} s</span>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-3">
        <span className="mr-1 inline-block size-2.5 rounded-sm bg-critical align-middle" aria-hidden /> flagged window
        <span className="ml-3 mr-1 inline-block size-2.5 rounded-sm bg-accent-light/60 align-middle" aria-hidden /> scored, not flagged
      </p>
    </div>
  )
}

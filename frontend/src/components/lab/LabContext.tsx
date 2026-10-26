import { Link } from 'react-router-dom'

import { lessonFor } from '../../lib/lessons'
import { SAMPLE_LABEL, SCRIPT_LABEL, type Scenario } from '../../lib/scenarios'
import type { AnalysisReport } from '../../lib/types'

/** Above the normal results: which sample this is, and that it was analyzed for real. */
export function LabBanner({ scenario, onBack }: { scenario: Scenario; onBack: () => void }) {
  return (
    <section aria-labelledby="lab-banner-title" className="border-b border-line pb-6">
      <p className="font-mono text-sm text-accent">Scenario Lab</p>
      <h2 id="lab-banner-title" className="mt-1 font-display text-2xl font-medium">
        {scenario.title}
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-ink-2">
        {SAMPLE_LABEL} It was analyzed just now by the VoxShield backend; everything below is that analysis, not a written outcome.
      </p>
      <details className="mt-3 max-w-2xl text-sm">
        <summary className="flex min-h-6 cursor-pointer items-center text-accent underline-offset-4 hover:underline pointer-coarse:min-h-11">Script spoken in this sample</summary>
        <p className="mt-2 font-mono text-xs text-ink-3">{SCRIPT_LABEL}</p>
        <p className="mt-1 text-ink-2">{scenario.script}</p>
      </details>
      <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <button type="button" onClick={onBack} className="inline-flex min-h-6 items-center text-accent underline underline-offset-4 pointer-coarse:min-h-11">
          Try another scenario
        </button>
        <Link to="/" className="inline-flex min-h-6 items-center text-accent underline underline-offset-4 pointer-coarse:min-h-11">
          Use your own recording instead
        </Link>
      </p>
    </section>
  )
}

/** Below the normal results: what this particular result does and does not establish. */
export function LessonPanel({ report }: { report: AnalysisReport }) {
  const lesson = lessonFor(report, true)
  return (
    <section aria-labelledby="lesson-heading" className="border-t border-line pt-8">
      <h2 id="lesson-heading" className="font-display text-3xl font-medium">
        What this result can and cannot show
      </h2>
      <div className="mt-5 grid gap-8 md:grid-cols-2">
        <div>
          <h3 className="font-mono text-sm text-ink-3">It can show</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-ink-2">
            {lesson.can.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-mono text-sm text-ink-3">It cannot show</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-ink-2">
            {lesson.cannot.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

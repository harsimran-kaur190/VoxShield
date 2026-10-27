import { Link } from 'react-router-dom'

import { languageName } from '../../lib/languages'
import { lessonFor } from '../../lib/lessons'
import { LAB_LANGUAGE_STATUS, SAMPLE_LABEL, SCRIPT_LABEL, type Scenario } from '../../lib/scenarios'
import type { AnalysisReport } from '../../lib/types'

/** Which languages the Lab covers and how far each has been checked, so nobody mistakes a sample for a validation. */
export function LabLanguageStatus() {
  return (
    <details className="mt-6 max-w-2xl">
      <summary className="flex min-h-6 cursor-pointer items-center font-mono text-sm text-ink-3 underline-offset-4 hover:underline pointer-coarse:min-h-11">Language support in this Lab</summary>
      <dl className="mt-2 space-y-1.5 text-sm">
        {LAB_LANGUAGE_STATUS.map((row) => (
          <div key={row.language} className="grid grid-cols-[5rem_1fr] gap-3">
            <dt className="font-medium text-ink">{row.language}</dt>
            <dd className="text-ink-2">{row.status}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

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
      <p className="mt-1 max-w-2xl text-sm text-ink-3">Language: {languageName(scenario.language)}, set for this sample.</p>
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

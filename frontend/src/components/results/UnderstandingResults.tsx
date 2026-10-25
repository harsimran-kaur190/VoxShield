import { ChevronDown } from 'lucide-react'
import { Link } from 'react-router-dom'

export function UnderstandingResults() {
  return (
    <details className="group border-t border-line pt-6">
      <summary className="flex cursor-pointer items-center justify-between gap-3 font-display text-2xl font-medium">
        Understanding these results
        <ChevronDown className="size-5 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-2">
        <li>Voice classification is a model assessment, not definitive proof about the voice or the caller.</li>
        <li>Scam indicators are clues found in the conversation, not proof of fraud.</li>
        <li>Either assessment can be inconclusive, and the two are never combined into one score.</li>
      </ul>
      <p className="mt-4 text-ink-3">
        Models, thresholds, and known limits are listed under{' '}
        <Link to="/about" className="text-accent underline underline-offset-4">
          Evaluation &amp; limits
        </Link>
        .
      </p>
    </details>
  )
}

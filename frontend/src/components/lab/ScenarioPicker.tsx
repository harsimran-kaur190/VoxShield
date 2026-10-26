import { Loader2, Play } from 'lucide-react'

import { SAMPLE_LABEL, SCENARIOS, SCRIPT_LABEL } from '../../lib/scenarios'

interface Props {
  selectedId: string
  onSelect: (id: string) => void
  onAnalyze: () => void
  /** The sample is being fetched. */
  busy: boolean
  /** Why analysis cannot start right now, if it cannot. */
  blockedReason: string | null
}

export function ScenarioPicker({ selectedId, onSelect, onAnalyze, busy, blockedReason }: Props) {
  const selected = SCENARIOS.find((s) => s.id === selectedId) ?? SCENARIOS[0]
  return (
    <div className="grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-12">
      <fieldset>
        <legend className="font-mono text-sm text-ink-3">Choose a scenario</legend>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {SCENARIOS.map((scenario, index) => (
            <li key={scenario.id}>
              <label className="relative flex min-h-11 cursor-pointer items-baseline gap-3 px-2 py-3 hover:bg-paper-2 has-[:checked]:bg-accent-tint/60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2">
                <input type="radio" name="scenario" value={scenario.id} checked={scenario.id === selected.id} onChange={() => onSelect(scenario.id)} className="peer sr-only" />
                <span className="font-mono text-xs text-ink-3">{String(index + 1).padStart(2, '0')}</span>
                <span className="font-medium peer-checked:text-ink">{scenario.title}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <section aria-labelledby="scenario-title" aria-live="polite" className="min-w-0">
        <h2 id="scenario-title" className="font-display text-3xl font-medium">
          {selected.title}
        </h2>
        <dl className="mt-4 space-y-4">
          <div>
            <dt className="font-mono text-sm text-ink-3">What you are testing</dt>
            <dd className="mt-1 text-ink-2">{selected.testing}</dd>
          </div>
          <div>
            <dt className="font-mono text-sm text-ink-3">What to look at in the result</dt>
            <dd className="mt-1 text-ink-2">{selected.lookFor}</dd>
          </div>
        </dl>

        <figure className="mt-6 border-l-2 border-line-strong pl-4">
          <figcaption className="font-mono text-xs text-ink-3">{SCRIPT_LABEL}</figcaption>
          <blockquote className="mt-2 text-ink">{selected.script}</blockquote>
        </figure>

        <div className="mt-6">
          <p className="font-mono text-xs text-ink-3">{SAMPLE_LABEL}</p>
          {/* key resets the player when another scenario is chosen */}
          <audio key={selected.id} controls preload="none" src={selected.audioUrl} aria-label={`Sample audio for ${selected.title}`} className="mt-2 w-full" />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={onAnalyze}
            disabled={busy || blockedReason !== null}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-6 py-2.5 font-medium text-paper hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4 fill-current" aria-hidden />}
            {busy ? 'Loading sample' : 'Analyze this sample'}
          </button>
          <p className="max-w-md text-sm text-ink-3">
            {blockedReason ?? 'This sends the sample audio to the same analysis as an uploaded file. Nothing is kept after the analysis.'}
          </p>
        </div>
      </section>
    </div>
  )
}

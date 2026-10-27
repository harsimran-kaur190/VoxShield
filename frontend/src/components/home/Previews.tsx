import { FlaskConical, PhoneIncoming } from 'lucide-react'
import { formatTimestamp } from '../../lib/highlight'
import { DEMO_CALL, DEMO_DATA_LABEL } from '../../lib/demo'
import { splitByEvidence, type DemoSegment } from '../../lib/demoScenario'
import { Badge, SimulatedBadge } from '../ui/Badge'

/** A fixed, decorative bar pattern. It is not drawn from any audio. */
function DecorativeWave({ bars = 48, className = '' }: { bars?: number; className?: string }) {
  return (
    <div className={`flex items-center gap-[3px] ${className}`} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className="w-full rounded-full bg-current" style={{ height: `${18 + ((i * 37) % 70)}%` }} />
      ))}
    </div>
  )
}

function Dot({ className }: { className: string }) {
  return <span className={`size-2 shrink-0 rounded-full ${className}`} aria-hidden />
}

function DemoTag() {
  return <span className="font-mono text-[11px] uppercase tracking-wide text-ink-3">Demo data</span>
}

function Caller({ compact = false }: { compact?: boolean }) {
  const { caller } = DEMO_CALL
  return (
    <div className="flex items-center gap-3">
      <span className={`grid shrink-0 place-items-center rounded-full bg-ink font-semibold text-paper ${compact ? 'size-10' : 'size-12 text-lg'}`} aria-hidden>
        {caller.initials}
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-ink">{caller.name}</p>
        <p className="truncate text-sm text-ink-3">{compact ? caller.number : caller.claimed}</p>
      </div>
    </div>
  )
}

/** Hero graphic: a simulated incoming call beside a small preview of the two separate results. */
export function HeroPreview() {
  const { intent, voice } = DEMO_CALL
  return (
    <figure className="relative" aria-label="Simulated preview of an incoming call and its analysis. Demo data, not a real result.">
      <div className="rounded-card border border-line bg-card p-5 shadow-raised">
        <div className="flex items-center justify-between gap-3">
          <SimulatedBadge>Simulated preview</SimulatedBadge>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
            <PhoneIncoming className="size-3.5" aria-hidden />
            Incoming call
          </span>
        </div>
        <div className="mt-5">
          <Caller compact />
        </div>
        <DecorativeWave className="mt-5 h-12 text-accent-light/70" />
        <dl className="mt-5 divide-y divide-line rounded-control border border-line text-sm">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <dt className="text-ink-3">Scam intent</dt>
            <dd className="inline-flex items-center gap-2 font-medium text-ink">
              <Dot className={intent.dot} />
              {intent.label}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <dt className="text-ink-3">Voice check</dt>
            <dd className="inline-flex items-center gap-2 font-medium text-ink">
              <Dot className={voice.dot} />
              {voice.label}
            </dd>
          </div>
        </dl>
        <figcaption className="mt-3 text-xs text-ink-3">{DEMO_DATA_LABEL}</figcaption>
      </div>
    </figure>
  )
}

function Highlighted({ line }: { line: DemoSegment }) {
  return splitByEvidence(line).map((part, i) =>
    part.evidence ? (
      <mark key={i} className="rounded bg-amber-tint px-0.5 text-ink ring-1 ring-amber-light">
        {part.text}
      </mark>
    ) : (
      <span key={i}>{part.text}</span>
    ),
  )
}

/** A fuller example report: caller, transcript with quoted phrases, and the two results kept apart. */
export function ProductPreview() {
  const { transcript, intent, voice } = DEMO_CALL
  return (
    <div className="rounded-card border border-line bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <Caller />
        <Badge tone="simulated" icon={FlaskConical} className="uppercase tracking-wide">
          Simulated preview
        </Badge>
      </div>
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">Transcript</h3>
            <DemoTag />
          </div>
          <ol className="mt-3 space-y-3">
            {transcript.map((line) => (
              <li key={line.id} className="flex gap-3 text-sm leading-relaxed text-ink-2">
                <span className="mt-0.5 shrink-0 font-mono text-xs text-ink-3">{formatTimestamp(line.start)}</span>
                <p>
                  <Highlighted line={line} />
                </p>
              </li>
            ))}
          </ol>
        </div>
        <div className="space-y-3 lg:col-span-2">
          <section aria-label="Scam intent, demo result" className="rounded-control border border-line p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">Scam intent</h3>
              <DemoTag />
            </div>
            <p className="mt-2 inline-flex items-center gap-2 font-medium text-ink">
              <Dot className={intent.dot} />
              {intent.label}
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Indicators quoted from the transcript">
              {intent.categories.map((category) => (
                <li key={category}>
                  <Badge tone="warning">{category}</Badge>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Voice check, demo result" className="rounded-control border border-line p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">Voice check</h3>
              <DemoTag />
            </div>
            <p className="mt-2 inline-flex items-center gap-2 font-medium text-ink">
              <Dot className={voice.dot} />
              {voice.label}
            </p>
            <p className="mt-2 text-sm text-ink-3">{voice.note}</p>
          </section>
        </div>
      </div>
      <p className="border-t border-line bg-paper-2 px-5 py-3 text-xs text-ink-3 sm:px-6">
        {DEMO_DATA_LABEL} The two results are reported separately and never combined into one score.
      </p>
    </div>
  )
}

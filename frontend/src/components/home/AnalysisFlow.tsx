import type { LucideIcon } from 'lucide-react'
import { AudioLines, FileAudio, FileText, MessageSquareText } from 'lucide-react'

/** A fixed bar pattern standing for "a recording". It is not drawn from any audio. */
function Bars() {
  return (
    <span className="flex h-5 flex-1 items-center gap-[2px] text-accent-light/70" aria-hidden>
      {Array.from({ length: 28 }, (_, i) => (
        <span key={i} className="w-full rounded-full bg-current" style={{ height: `${25 + ((i * 37) % 70)}%` }} />
      ))}
    </span>
  )
}

/** Thin connectors: one line on phones, where the steps stack, and a fork or join beside the two paths on wider screens. */
function Connector({ join = false }: { join?: boolean }) {
  return (
    <div className="relative h-6" aria-hidden>
      <span className="absolute left-1/2 top-0 h-full w-px bg-line-strong sm:hidden" />
      <span className={`absolute left-1/2 hidden h-3 w-px bg-line-strong sm:block ${join ? 'bottom-0' : 'top-0'}`} />
      <span className="absolute inset-x-1/4 top-3 hidden h-px bg-line-strong sm:block" />
      <span className={`absolute left-1/4 hidden h-3 w-px bg-line-strong sm:block ${join ? 'top-0' : 'bottom-0'}`} />
      <span className={`absolute right-1/4 hidden h-3 w-px bg-line-strong sm:block ${join ? 'top-0' : 'bottom-0'}`} />
    </div>
  )
}

function Path({ icon: Icon, title, text, signal, tone, delay }: { icon: LucideIcon; title: string; text: string; signal: string; tone: string; delay: string }) {
  return (
    <li className="rise rounded-card border border-line bg-card p-4 shadow-card" style={{ animationDelay: delay }}>
      <span className={`grid size-8 place-items-center rounded-control ${tone}`}>
        <Icon className="size-4" aria-hidden />
      </span>
      <p className="mt-3 font-semibold text-ink">{title}</p>
      <p className="mt-0.5 text-sm text-ink-2">{text}</p>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-ink-3">{signal}</p>
    </li>
  )
}

/**
 * Hero graphic: one recording, two independent analyses, one report that keeps them apart. It shows how VoxShield
 * works, not a result, so it carries no scores, callers or verdicts.
 */
export function AnalysisFlow() {
  return (
    <figure aria-labelledby="flow-caption" className="mx-auto w-full max-w-md">
      <figcaption id="flow-caption" className="sr-only">
        How VoxShield works: an audio recording is analyzed along two independent paths, speech analysis for scam indicators and voice analysis for signs of
        synthetic speech. Both findings go into one evidence-based report, side by side and never combined into one score.
      </figcaption>

      <div className="rise flex items-center gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-card" aria-hidden>
        <FileAudio className="size-4 shrink-0 text-ink-3" />
        <span className="shrink-0 text-sm font-medium text-ink">Audio recording</span>
        <Bars />
      </div>

      <Connector />
      <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4" aria-hidden>
        <Path
          icon={MessageSquareText}
          title="Speech analysis"
          text="Detects suspicious requests and scam indicators"
          signal="What is said"
          tone="bg-accent-tint/60 text-accent-deep"
          delay="80ms"
        />
        <Path icon={AudioLines} title="Voice analysis" text="Assesses signs of synthetic speech" signal="How it sounds" tone="bg-paper-2 text-ink" delay="160ms" />
      </ul>
      <Connector join />

      <div className="rise flex items-start gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-card" style={{ animationDelay: '240ms' }} aria-hidden>
        <FileText className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Evidence-based report</p>
          <p className="text-sm text-ink-2">Both findings side by side, with the transcript and timestamps. Never merged into one score.</p>
        </div>
      </div>
    </figure>
  )
}

import { ArrowLeft, History, Printer } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { formatCompletedAt, HISTORY_PATH, ID_NOTE } from '../../lib/history'
import { Button } from '../ui/Button'
import { buttonClass } from '../ui/styles'

interface Props {
  id: string
  completedAt: string
  /** Real audio, a Lab sample or a simulation, as a badge. */
  typeBadge: ReactNode
  typeLabel: string
  title: string
  /** Extra facts for the header, such as file details or how far a simulation played. */
  facts: [string, ReactNode][]
  back: { to: string; label: string }
  children: ReactNode
}

/** The shell shared by both report kinds: identity of the report, navigation, and print. */
export function ReportFrame({ id, completedAt, typeBadge, typeLabel, title, facts, back, children }: Props) {
  return (
    <article aria-labelledby="report-title" className="rise space-y-8">
      <nav aria-label="Report" className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex flex-wrap gap-2">
          <Link to={HISTORY_PATH} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
            <History className="size-4" aria-hidden />
            History
          </Link>
          <Link to={back.to} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
            <ArrowLeft className="size-4" aria-hidden />
            {back.label}
          </Link>
        </div>
        <Button variant="secondary" size="sm" icon={Printer} onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </nav>

      <header className="rounded-card border border-line bg-card p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-sm text-ink-3">Forensic report</p>
          {typeBadge}
        </div>
        <h1 id="report-title" className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">
          {title}
        </h1>
        <dl className="mt-5 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <Fact label="Report ID">
            <code className="font-mono text-xs text-ink">{id}</code>
            <span className="block text-xs text-ink-3">{ID_NOTE}</span>
          </Fact>
          <Fact label="Completed">{formatCompletedAt(completedAt)}</Fact>
          <Fact label="Analysis type">{typeLabel}</Fact>
          {facts.map(([label, value]) => (
            <Fact key={label} label={label}>
              {value}
            </Fact>
          ))}
        </dl>
      </header>

      {children}
    </article>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-ink-2">{children}</dd>
    </div>
  )
}

/** A numbered report section. */
export function ReportSection({ id, kicker, title, children }: { id: string; kicker: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="break-inside-avoid-page">
      <p className="font-mono text-sm text-accent">{kicker}</p>
      <h2 id={id} className="mt-1 font-display text-2xl font-medium">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** For a part of the report the analysis did not produce: grey, and never worded as a negative result. */
export function Unavailable({ children }: { children: ReactNode }) {
  return <p className="rounded-control border border-dashed border-line-strong bg-paper-2 p-4 text-sm text-ink-2">{children}</p>
}

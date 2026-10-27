import type { LucideIcon } from 'lucide-react'
import { ArrowRight, AudioLines, Info, ListChecks, PhoneIncoming, ScanSearch, Upload } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { AnalysisFlow } from '../components/home/AnalysisFlow'
import { buttonClass } from '../components/ui/styles'
import { DEMO_CALL_PATH } from '../lib/callSimulation'

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Upload, title: 'Provide an audio sample', text: 'Upload or record a call, or pick a Scenario Lab sample.' },
  { icon: ScanSearch, title: 'Analyze it', text: 'Scam intent is read from the transcript; the voice is checked separately.' },
  { icon: ListChecks, title: 'Review the evidence', text: 'Each finding quotes the passage and time it came from.' },
]

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-20 sm:mt-24">
      <h2 id={id} className="text-2xl font-semibold text-ink sm:text-3xl">
        {title}
      </h2>
      {intro && <p className="mt-2 max-w-2xl text-ink-2">{intro}</p>}
      <div className="mt-8">{children}</div>
    </section>
  )
}

function CallCta() {
  return (
    <Link to={DEMO_CALL_PATH} className={buttonClass({ size: 'lg' })}>
      <PhoneIncoming className="size-4" aria-hidden />
      Simulate an Incoming Call
    </Link>
  )
}

function AnalyzeCta() {
  return (
    <Link to="/" className={buttonClass({ variant: 'secondary', size: 'lg' })}>
      <AudioLines className="size-4" aria-hidden />
      Analyze Audio
    </Link>
  )
}

export function HomePage() {
  return (
    <div>
      <section aria-labelledby="hero-heading" className="grid items-center gap-12 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="text-sm font-medium text-accent">AI-assisted voice scam analysis</p>
          <h1 id="hero-heading" className="mt-3 text-4xl font-semibold leading-[1.08] text-ink sm:text-5xl lg:text-6xl">
            Hear the threat before it’s too late.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-ink-2">VoxShield checks a call recording for scam indicators in what is said, and separately for signs of synthetic speech, with the evidence behind each finding.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <CallCta />
            <AnalyzeCta />
          </div>
          <p className="mt-6 flex max-w-xl items-start gap-2 text-sm text-ink-3">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            VoxShield analyzes audio you provide. It does not listen to, intercept or block phone calls; the incoming call is a simulation.
          </p>
        </div>
        <div className="lg:col-span-5">
          <AnalysisFlow />
        </div>
      </section>

      <Section id="steps-heading" title="How it works">
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="rounded-card border border-line bg-card p-5 shadow-card">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-control bg-accent-tint/60 text-accent-deep">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="font-mono text-xs text-ink-3">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 font-semibold text-ink">{title}</h3>
              <p className="mt-1 text-sm text-ink-2">{text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <aside aria-labelledby="limits-heading" className="mt-12 rounded-card border border-line bg-paper-2 p-5 sm:p-6">
        <h2 id="limits-heading" className="font-semibold text-ink">
          What VoxShield can’t tell you
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>Model outputs can be wrong in both directions. No finding is proof, and no clean result means a call is safe.</li>
          <li>A genuine human voice can be used for a scam.</li>
          <li>Synthetic speech does not automatically mean a scam.</li>
          <li>Scam intent and voice are reported separately and never combined into one score.</li>
          <li>English is checked directly. Hindi is checked through an English translation, which has not been validated.</li>
        </ul>
        <Link to="/about" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline">
          Read the evaluation and limits
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </aside>

    </div>
  )
}

import { ArrowRight, AudioLines, Home, Info, Phone, PhoneCall, PhoneIncoming, PhoneOff, RotateCcw } from 'lucide-react'
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router-dom'

import { CALL_DISCLAIMER, DEMO_ANALYSIS_PATH, type CallPhase } from '../../lib/callSimulation'
import { DEMO_CALL } from '../../lib/demo'
import { SimulatedBadge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { buttonClass } from '../ui/styles'

interface Props {
  phase: CallPhase
  onAccept: () => void
  onDecline: () => void
  onRestart: () => void
}

/** The simulated incoming call, from ringing to accepted or declined. Purely visual: no audio, microphone or network. */
export function CallScreen({ phase, onAccept, onDecline, onRestart }: Props) {
  const heading = useRef<HTMLHeadingElement>(null)
  const shown = useRef(phase)
  // When the call changes state, move focus to the new heading so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (shown.current === phase) return
    shown.current = phase
    heading.current?.focus()
  }, [phase])

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-raised">
        <div className="flex items-center justify-between border-b border-line bg-paper-2 px-5 py-3">
          <SimulatedBadge>Simulated call</SimulatedBadge>
          <span className="text-xs text-ink-3">VoxShield demo</span>
        </div>
        <div className="px-6 py-8 sm:px-8" aria-live="polite">
          {phase === 'ringing' && <Ringing heading={heading} onAccept={onAccept} onDecline={onDecline} />}
          {phase === 'accepted' && <Accepted heading={heading} onRestart={onRestart} />}
          {phase === 'declined' && <Declined heading={heading} onRestart={onRestart} />}
        </div>
      </div>
      <p className="mt-4 flex items-start gap-2 text-sm text-ink-3">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {CALL_DISCLAIMER}
      </p>
    </div>
  )
}

type HeadingRef = RefObject<HTMLHeadingElement | null>

function Title({ heading, children }: { heading: HeadingRef; children: ReactNode }) {
  return (
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold text-ink focus:outline-none">
      {children}
    </h1>
  )
}

function Ringing({ heading, onAccept, onDecline }: { heading: HeadingRef; onAccept: () => void; onDecline: () => void }) {
  const { caller } = DEMO_CALL
  return (
    <div className="text-center">
      <div className="relative mx-auto grid size-24 place-items-center" aria-hidden>
        <span className="call-ring absolute inset-0 rounded-full bg-accent/30" />
        <span className="call-ring absolute inset-0 rounded-full bg-accent/30 [animation-delay:1.2s]" />
        <span className="relative grid size-24 place-items-center rounded-full bg-ink text-3xl font-semibold text-paper ring-4 ring-card">{caller.initials}</span>
      </div>
      <p className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
        <PhoneIncoming className="size-4" aria-hidden />
        Incoming call
      </p>
      <Title heading={heading}>{caller.name}</Title>
      <p className="mt-1 text-sm text-ink-3">{caller.number}</p>
      <div className="mt-8 grid grid-cols-2 gap-3">
        <Button variant="secondary" size="lg" icon={PhoneOff} onClick={onDecline}>
          Decline
        </Button>
        <Button size="lg" icon={Phone} onClick={onAccept}>
          Accept Call
        </Button>
      </div>
    </div>
  )
}

function Accepted({ heading, onRestart }: { heading: HeadingRef; onRestart: () => void }) {
  return (
    <div>
      <span className="grid size-12 place-items-center rounded-full bg-accent-tint text-accent-deep">
        <PhoneCall className="size-5" aria-hidden />
      </span>
      <p className="mt-5 text-sm font-medium text-accent">Simulated call accepted</p>
      <Title heading={heading}>Preparing simulated analysis</Title>
      <p className="mt-2 text-ink-2">
        The next screen walks through how VoxShield would review a call like this one, using demo data. Nothing is being recorded and no audio is sent anywhere.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link to={DEMO_ANALYSIS_PATH} className={buttonClass({ size: 'lg' })}>
          Continue to Analysis Demo
          <ArrowRight className="size-4" aria-hidden />
        </Link>
        <Button variant="ghost" size="lg" icon={RotateCcw} onClick={onRestart}>
          Restart simulation
        </Button>
      </div>
    </div>
  )
}

function Declined({ heading, onRestart }: { heading: HeadingRef; onRestart: () => void }) {
  return (
    <div>
      <span className="grid size-12 place-items-center rounded-full bg-paper-2 text-ink-3">
        <PhoneOff className="size-5" aria-hidden />
      </span>
      <Title heading={heading}>Simulation declined</Title>
      <p className="mt-2 text-ink-2">You ended the simulated call. It only existed on this page, so no real call was declined or affected.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link to="/home" className={buttonClass({ variant: 'secondary' })}>
          <Home className="size-4" aria-hidden />
          Return Home
        </Link>
        <Link to="/" className={buttonClass()}>
          <AudioLines className="size-4" aria-hidden />
          Open Analyze
        </Link>
        <Button variant="ghost" icon={RotateCcw} onClick={onRestart}>
          Restart simulation
        </Button>
      </div>
    </div>
  )
}

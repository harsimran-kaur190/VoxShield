import { AlertOctagon, AlertTriangle, ArrowRight, AudioLines, CheckCircle2, FileText, Pause, Play, RotateCcw, Square, Volume2, VolumeX } from 'lucide-react'
import type { RefObject } from 'react'
import { Link } from 'react-router-dom'

import type { DemoVoiceMode } from '../../../hooks/useDemoAudio'
import { formatTimestamp } from '../../../lib/highlight'
import { isOver, type SimulationState } from '../../../lib/liveSimulation'
import type { Waveform as WaveformData } from '../../../lib/waveform'
import type { ScamIntentBand } from '../../../lib/scamIntentScore'
import { Logo } from '../../Logo'
import { Waveform } from '../../Waveform'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { buttonClass } from '../../ui/styles'

const STATUS = {
  running: { label: 'Simulation running', dot: 'bg-accent animate-pulse' },
  paused: { label: 'Paused', dot: 'bg-amber-light' },
  finished: { label: 'Simulated call finished', dot: 'bg-ok' },
  ended: { label: 'Simulation ended', dot: 'bg-ink-3' },
} as const

interface SoundProps {
  mode: DemoVoiceMode
  onToggle: () => void
  onEnable: () => void
}

/** Controls the read-aloud caller voice. */
export function SoundControl({ mode, onToggle, onEnable }: SoundProps) {
  if (mode === 'unsupported') return <p className="self-center text-xs text-ink-3">Audio playback isn’t available in this browser.</p>
  if (mode === 'blocked')
    return (
      <Button size="sm" icon={Volume2} onClick={onEnable}>
        Enable Sound
      </Button>
    )
  return (
    <Button variant="ghost" size="sm" icon={mode === 'on' ? VolumeX : Volume2} onClick={onToggle}>
      {mode === 'on' ? 'Mute Caller' : 'Unmute Caller'}
    </Button>
  )
}

interface HeaderProps {
  state: SimulationState
  /** This run's forensic report. */
  reportHref: string
  sound: SoundProps
  onPause: () => void
  onResume: () => void
  onEnd: () => void
}

export function DashboardHeader({ state, reportHref, sound, onPause, onResume, onEnd }: HeaderProps) {
  const status = STATUS[state.status]
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <Link to="/home" aria-label="VoxShield home" className="shrink-0 rounded-control">
            <Logo />
          </Link>
          <span className="hidden h-6 w-px bg-line sm:block" aria-hidden />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold text-ink sm:text-lg">Simulated Live Analysis</h1>
              <Badge tone="simulated" className="uppercase tracking-wide">
                Simulated
              </Badge>
            </div>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-3" role="status">
              <span className={`size-2 rounded-full ${status.dot}`} aria-hidden />
              {status.label}
              <span className="whitespace-nowrap font-mono tabular-nums text-ink-2" aria-label={`Simulated call duration ${formatTimestamp(state.elapsed)}`}>
                {formatTimestamp(state.elapsed)} / {formatTimestamp(state.duration)}
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isOver(state) && <SoundControl {...sound} />}
          {state.status === 'running' && (
            <Button variant="secondary" size="sm" icon={Pause} onClick={onPause}>
              Pause Analysis
            </Button>
          )}
          {state.status === 'paused' && (
            <Button variant="secondary" size="sm" icon={Play} onClick={onResume}>
              Resume Analysis
            </Button>
          )}
          {isOver(state) ? (
            <Link to={reportHref} className={buttonClass({ size: 'sm' })}>
              <FileText className="size-4" aria-hidden />
              View Forensic Report
            </Link>
          ) : (
            <Button variant="secondary" size="sm" icon={Square} onClick={onEnd}>
              End Simulation
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}

/**
 * The caller audio's waveform, drawn from the demo recording itself; the part already heard is coloured. If the
 * browser cannot decode it, a plain progress bar is shown instead of a made-up shape.
 */
export function SimulatedWaveform({ progress, waveform }: { progress: number; waveform: WaveformData | null | undefined }) {
  const played = `${Math.min(1, Math.max(0, progress)) * 100}%`
  return (
    <section aria-label="Caller audio" className="rounded-card border border-line bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <AudioLines className="size-3.5" aria-hidden />
          Caller audio
        </span>
        <span>Computer-generated speech</span>
      </div>
      <div className="relative mt-3 h-14" aria-hidden>
        {waveform ? (
          <>
            <Waveform peaks={waveform.peaks} className="absolute inset-0 h-full w-full text-line-strong" />
            <div className="absolute inset-0" style={{ clipPath: `inset(0 calc(100% - ${played}) 0 0)` }}>
              <Waveform peaks={waveform.peaks} className="h-full w-full text-accent" />
            </div>
          </>
        ) : (
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-paper-2">
            <div className="h-full bg-accent" style={{ width: played }} />
          </div>
        )}
      </div>
    </section>
  )
}

/** Shown once the script reaches its trigger point. Red only when the band is critical, which requires quoted evidence. */
export function SimulatedAlert({ band, onShowEvidence }: { band: ScamIntentBand; onShowEvidence?: () => void }) {
  const critical = band.id === 'critical'
  const Icon = critical ? AlertOctagon : AlertTriangle
  return (
    <div role="alert" className={`rise rounded-card border p-4 ${critical ? 'border-critical/30 bg-critical-tint' : 'border-amber-light/50 bg-amber-tint/50'}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-5 shrink-0 ${critical ? 'text-critical' : 'text-amber'}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={`font-semibold ${critical ? 'text-critical' : 'text-amber'}`}>Simulated alert: {band.label.toLowerCase()} scam-intent indicators</p>
          <p className="mt-1 text-sm text-ink-2">The caller asked for money urgently on an unexpected call. In a real situation, stop and verify the caller independently before sending anything.</p>
          {onShowEvidence && (
            <button type="button" onClick={onShowEvidence} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline">
              Show the evidence
              <ArrowRight className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface CompletionProps {
  state: SimulationState
  reportHref: string
  indicatorCount: number
  heading: RefObject<HTMLHeadingElement | null>
  onViewFull: () => void
  onRestart: () => void
}

export function CompletionPanel({ state, reportHref, indicatorCount, heading, onViewFull, onRestart }: CompletionProps) {
  const ended = state.status === 'ended'
  return (
    <section aria-labelledby="completion-heading" className="rise rounded-card border border-line bg-card p-5 shadow-card">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
        <div className="min-w-0">
          <h2 id="completion-heading" ref={heading} tabIndex={-1} className="font-semibold text-ink focus:outline-none">
            {ended ? 'Simulation ended' : 'Simulated call finished'}
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            {ended ? `Stopped at ${formatTimestamp(state.elapsed)} of ${formatTimestamp(state.duration)}. ` : ''}
            {indicatorCount} illustrative indicator{indicatorCount === 1 ? '' : 's'} flagged. The timers have stopped. Saved to History for this tab.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={reportHref} className={buttonClass()}>
          <FileText className="size-4" aria-hidden />
          View Forensic Report
        </Link>
        <Button variant="secondary" icon={FileText} onClick={onViewFull}>
          View Full Transcript
        </Button>
        <Link to="/" className={buttonClass({ variant: 'secondary' })}>
          <AudioLines className="size-4" aria-hidden />
          Analyze Real Audio
        </Link>
        <Button variant="ghost" icon={RotateCcw} onClick={onRestart}>
          Restart Simulation
        </Button>
      </div>
    </section>
  )
}

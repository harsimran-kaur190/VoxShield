import { ArrowRight, Info } from 'lucide-react'
import { useEffect, useReducer, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { CompletionPanel, DashboardHeader, SimulatedAlert, SimulatedWaveform } from '../components/demo/dashboard/DashboardChrome'
import { LiveTranscript } from '../components/demo/dashboard/LiveTranscript'
import { IntentAnalysisCard, RecommendationsCard, ScamIntentCard, VoiceAuthenticityCard } from '../components/demo/dashboard/Panels'
import { scrollToId } from '../components/results/scroll'
import { useDemoAudio, useDemoWaveform } from '../hooks/useDemoAudio'
import { alertReached, demoScore, indicatorsFound, segmentDomId, segmentsReached, SIMULATION_NOTICE, SPOKEN_VOICE_NOTE, STRANDED_TRAVELLER, type DemoScenario } from '../lib/demoScenario'
import { isOver, simulationReducer, startSimulation, TICK_MS, type SimulationState } from '../lib/liveSimulation'
import { DEMO_REPORT_PATH } from '../lib/callSimulation'
import { addEntry, reportPath } from '../lib/history'
import { scamIntentBand } from '../lib/scamIntentScore'

export function DemoDashboardPage() {
  return <LiveDashboard scenario={STRANDED_TRAVELLER} />
}

interface Props {
  scenario: DemoScenario
  /** Starting point, for tests and previews. Defaults to a fresh, running simulation. */
  initialState?: SimulationState
  initialEvidence?: string | null
  initialFull?: boolean
}

/** The simulated live-analysis dashboard. Everything on it comes from the prewritten scenario, never from the backend. */
export function LiveDashboard({ scenario, initialState, initialEvidence = null, initialFull = false }: Props) {
  const [state, dispatch] = useReducer(simulationReducer, initialState ?? startSimulation(scenario.duration))
  const [selected, setSelected] = useState<string | null>(initialEvidence)
  const [full, setFull] = useState(initialFull)
  const over = isOver(state)

  const voice = useDemoAudio(scenario.audioUrl, state.status, state.elapsed)
  const waveform = useDemoWaveform(scenario.audioUrl)
  const audioTime = useRef(voice.time)
  useEffect(() => {
    audioTime.current = voice.time
  })

  // The only timer on the page. It exists only while running, so pausing, ending, finishing and leaving all stop it.
  // While the caller audio plays the clock follows it; otherwise (no audio, still loading) it keeps its own time.
  useEffect(() => {
    if (state.status !== 'running') return
    const timer = setInterval(() => {
      const heard = audioTime.current()
      dispatch(heard === null ? { type: 'tick', seconds: TICK_MS / 1000 } : { type: 'syncTo', elapsed: heard })
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [state.status])

  // A finished or ended run is recorded once in this tab's history, so its report can be reopened. Restarting starts a
  // new run, which is recorded separately. Until the entry exists the report link falls back to the latest simulation.
  const [entryId, setEntryId] = useState<string | null>(null)
  const recorded = useRef(false)
  useEffect(() => {
    if (!over) {
      recorded.current = false
      return
    }
    if (recorded.current) return
    recorded.current = true
    const status = state.status === 'ended' ? 'ended' : 'finished'
    const entry = addEntry({ kind: 'simulation', scenarioId: scenario.id, title: scenario.title, status, elapsed: state.elapsed, duration: state.duration })
    setEntryId(entry.id)
  }, [over, scenario.id, scenario.title, state.status, state.elapsed, state.duration])
  const reportHref = entryId ? reportPath(entryId) : DEMO_REPORT_PATH

  const completionHeading = useRef<HTMLHeadingElement>(null)
  const wasOver = useRef(over)
  useEffect(() => {
    if (over && !wasOver.current) completionHeading.current?.focus()
    wasOver.current = over
  }, [over])

  const reached = segmentsReached(scenario, state.elapsed)
  const found = indicatorsFound(scenario, reached)
  const score = demoScore(found)
  const band = scamIntentBand(score, found.reduce((n, indicator) => n + indicator.evidence.length, 0))
  const showFull = full && over

  const select = (evidenceId: string, segmentId: string) => {
    setSelected(evidenceId)
    scrollToId(segmentDomId(segmentId))
  }
  const alertSegment = scenario.segments.find((segment) => segment.id === scenario.alertAtSegment)

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Skip to content
      </a>
      <DashboardHeader
        state={state}
        reportHref={reportHref}
        sound={{ mode: voice.mode, onToggle: voice.toggle, onEnable: voice.enable }}
        onPause={() => dispatch({ type: 'pause' })}
        onResume={() => dispatch({ type: 'resume' })}
        onEnd={() => dispatch({ type: 'end' })}
      />
      <div className="border-b border-line bg-paper-2">
        <p className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs text-ink-2 sm:px-6">
          <span className="inline-flex items-start gap-1.5">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            {SIMULATION_NOTICE}
          </span>
          <Link to="/" className="inline-flex items-center gap-1 font-medium text-accent underline-offset-4 hover:underline">
            Analyze a real recording
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </p>
      </div>

      <main id="main" className="mx-auto grid w-full max-w-7xl flex-1 gap-5 px-4 py-6 sm:px-6 lg:grid-cols-12">
        <div className="min-w-0 space-y-5 lg:col-span-7 xl:col-span-8">
          {over && (
            <CompletionPanel
              state={state}
              reportHref={reportHref}
              indicatorCount={found.length}
              heading={completionHeading}
              onViewFull={() => setFull(true)}
              onRestart={() => {
                setSelected(null)
                setFull(false)
                setEntryId(null)
                dispatch({ type: 'restart' })
              }}
            />
          )}
          {alertReached(scenario, state.elapsed) && alertSegment && alertSegment.evidence[0] && (
            <SimulatedAlert band={band} onShowEvidence={() => select(alertSegment.evidence[0].id, alertSegment.id)} />
          )}
          <SimulatedWaveform progress={state.elapsed / state.duration} waveform={waveform} />
          <LiveTranscript
            segments={showFull ? scenario.segments : reached}
            indicators={scenario.indicators}
            selectedEvidence={selected}
            onToggleEvidence={(id) => setSelected((current) => (current === id ? null : id))}
            full={showFull}
            canViewFull={over}
            onToggleFull={() => setFull((value) => !value)}
          />
        </div>
        <aside aria-label="Analysis" className="min-w-0 space-y-5 lg:col-span-5 xl:col-span-4">
          <ScamIntentCard score={score} band={band} found={found} simulated />
          <VoiceAuthenticityCard voice={scenario.voice} simulated note={voice.mode === 'unsupported' ? undefined : SPOKEN_VOICE_NOTE} />
          <IntentAnalysisCard found={found} onSelectEvidence={select} />
          <RecommendationsCard />
        </aside>
      </main>
    </div>
  )
}

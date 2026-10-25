import { Lock } from 'lucide-react'

import { AnalysesIntro } from '../components/AnalysesIntro'
import { AnalysisView } from '../components/AnalysisView'
import { BackendStatus } from '../components/BackendStatus'
import { ErrorNotice } from '../components/ErrorNotice'
import { ResultsView } from '../components/results/ResultsView'
import { InputStage } from '../components/InputStage'
import { useAnalysis } from '../hooks/useAnalysis'
import { useBackend } from '../hooks/useApi'

export function DashboardPage() {
  const backend = useBackend()
  const limits = backend.status === 'online' ? backend.limits : null
  const { state, start, retry, reset } = useAnalysis(limits)
  if (state.phase === 'done') return <ResultsView report={state.report} waveform={state.waveform} audio={state.audio} onReset={reset} onRetry={retry} />
  if (state.phase === 'running') {
    return <AnalysisView {...state} onCancel={reset} />
  }

  const error = state.phase === 'error' ? { title: state.canRetry ? "The analysis couldn't finish" : "We couldn't use that file", message: state.message } : null

  return (
    <div>
      <section className="grid items-center gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-6">
          <BackendStatus state={backend} />
          <h1 className="mt-5 font-display text-5xl font-medium leading-[1.04] tracking-tight sm:text-6xl">
            Beyond the Voice.
            <span className="block italic text-accent">Into the Truth.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg text-ink-2">
            Upload a call recording, or record one with your microphone. VoxShield checks whether the voice looks synthetic and quotes the phrases in the conversation that look like a scam.
          </p>
          <p className="mt-6 flex max-w-lg items-start gap-2 text-sm text-ink-3">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            Audio goes to a temporary file, is analyzed, and is deleted when the analysis ends. Neither audio nor transcript is stored.
          </p>
          {backend.status === 'offline' && (
            <p role="alert" className="mt-4 text-sm text-danger">
              The backend is not reachable. Start it with the commands in the README, then reload this page.
            </p>
          )}
        </div>
        <div className="space-y-4 lg:col-span-6">
          {error && (
            <ErrorNotice
              title={error.title}
              message={error.message}
              onRetry={state.phase === 'error' && state.canRetry ? retry : undefined}
              onDismiss={reset}
              dismissLabel="Dismiss"
            />
          )}
          <InputStage limits={limits} onFile={start} />
        </div>
      </section>
      <AnalysesIntro />
    </div>
  )
}

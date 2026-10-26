import { useCallback, useState } from 'react'

import { AnalysisView } from '../components/AnalysisView'
import { BackendStatus } from '../components/BackendStatus'
import { ErrorNotice } from '../components/ErrorNotice'
import { LabBanner, LessonPanel } from '../components/lab/LabContext'
import { ScenarioPicker } from '../components/lab/ScenarioPicker'
import { ResultsView } from '../components/results/ResultsView'
import { useAnalysis } from '../hooks/useAnalysis'
import { useBackend } from '../hooks/useApi'
import { analyzeScenario, SampleLoadError, SCENARIOS } from '../lib/scenarios'

export function LabPage() {
  const backend = useBackend()
  const limits = backend.status === 'online' ? backend.limits : null
  const { state, start, retry, reset } = useAnalysis(limits)
  const [selectedId, setSelectedId] = useState(SCENARIOS[0].id)
  const [ranId, setRanId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const analyze = useCallback(async () => {
    const scenario = SCENARIOS.find((s) => s.id === selectedId)
    if (!scenario) return
    setLoadError(null)
    setLoading(true)
    try {
      await analyzeScenario(scenario, (file) => {
        setRanId(scenario.id)
        return start(file)
      })
    } catch (error) {
      setLoadError(error instanceof SampleLoadError ? error.message : 'The sample could not be analyzed.')
    } finally {
      setLoading(false)
    }
  }, [selectedId, start])

  const back = useCallback(() => {
    reset()
    setRanId(null)
  }, [reset])

  const ran = SCENARIOS.find((s) => s.id === ranId)
  if (state.phase === 'done' && ran) {
    return (
      <div className="space-y-10">
        <LabBanner scenario={ran} onBack={back} />
        <ResultsView report={state.report} waveform={state.waveform} audio={state.audio} onReset={back} onRetry={retry} />
        <LessonPanel report={state.report} />
      </div>
    )
  }
  if (state.phase === 'running') return <AnalysisView {...state} onCancel={back} />

  const blockedReason =
    backend.status === 'offline'
      ? 'The backend is not reachable. Start it with the commands in the README, then reload this page.'
      : backend.status === 'checking'
        ? 'Checking that the backend is running.'
        : null
  const error =
    state.phase === 'error'
      ? { title: "The analysis couldn't finish", message: state.message }
      : loadError
        ? { title: "The sample couldn't be loaded", message: loadError }
        : null

  return (
    <div>
      <BackendStatus state={backend} />
      <h1 className="mt-5 font-display text-4xl font-medium tracking-tight sm:text-5xl">Scam Scenario Lab</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-2">
        Six short, made-up situations, each spoken by a computer-generated voice. Pick one, read what it tests, then run it through the same analysis as any uploaded file. The results are produced by the real analysis, not written in advance.
      </p>
      <p className="mt-2 max-w-2xl text-sm text-ink-3">
        The samples are synthetic speech and are not recordings of real calls. They show how the checks behave on these situations. They say nothing about accuracy on real calls.
      </p>

      <div className="mt-8 space-y-4">
        {error && (
          <ErrorNotice
            title={error.title}
            message={error.message}
            onRetry={state.phase === 'error' && state.canRetry ? retry : undefined}
            onDismiss={() => {
              setLoadError(null)
              back()
            }}
            dismissLabel="Dismiss"
          />
        )}
        <ScenarioPicker selectedId={selectedId} onSelect={setSelectedId} onAnalyze={analyze} busy={loading} blockedReason={blockedReason} />
      </div>
    </div>
  )
}

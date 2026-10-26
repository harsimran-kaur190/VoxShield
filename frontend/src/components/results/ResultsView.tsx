import { AlertTriangle, FileAudio, RotateCcw } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { useAudioPlayback } from '../../hooks/usePlayback'
import { formatBytes, formatDuration } from '../../lib/format'
import { indicatorKey } from '../../lib/highlight'
import { findingSeekTime, groupFindings } from '../../lib/playback'
import type { AnalysisReport } from '../../lib/types'
import type { Waveform } from '../../lib/waveform'
import { IntentSection } from './IntentSection'
import { NextStep } from './NextStep'
import { Overview } from './Overview'
import { PlaybackProvider } from './PlaybackProvider'
import { RecommendationsSection } from './RecommendationsSection'
import { scrollToFinding, scrollToId, scrollToMark } from './scroll'
import { Timeline } from './Timeline'
import { TranscriptWorkspace } from './TranscriptWorkspace'
import { UnderstandingResults } from './UnderstandingResults'
import { VoiceSection } from './VoiceSection'

const BANNERS = {
  partial: 'Part of the analysis could not run. The results below cover only what completed.',
  failed: 'The analysis could not be completed. No voice or scam-intent results are shown.',
} as const
const STATUS = { complete: 'Analysis complete', partial: 'Partial results', failed: 'Analysis failed' } as const

function processingNote(timings: Record<string, number>): string | null {
  const total = timings.total ?? Object.values(timings).reduce((a, b) => a + b, 0)
  if (!total) return null
  const load = timings.model_load ?? 0
  return `Processed in ${total.toFixed(1)} s${load > 0.5 ? `, including ${load.toFixed(1)} s loading models` : ''}.`
}

interface Props {
  report: AnalysisReport
  waveform?: Waveform | null
  /** The analyzed file or recording, held in memory for playback. Absent when it is no longer available. */
  audio?: Blob | null
  onReset: () => void
  onRetry?: () => void
}

export function ResultsView({ report, waveform, audio = null, onReset, onRetry }: Props) {
  const { audio: meta } = report
  const [selected, setSelected] = useState<string | null>(null)
  const { controller, element } = useAudioPlayback(audio, meta.duration_seconds)
  const groups = useMemo(() => groupFindings(report.intent.indicators), [report.intent.indicators])
  const knownFindings = useMemo(() => new Set(report.intent.indicators.map(indicatorKey)), [report.intent.indicators])
  const note = processingNote(report.timings_seconds)

  const seekToFinding = useCallback(
    (key: string) => {
      const group = groups.find((g) => g.ids.includes(key))
      if (group && findingSeekTime({ start_seconds: group.start_seconds }) !== null && group.start_seconds !== null) controller.seek(group.start_seconds)
    },
    [groups, controller],
  )
  // Choosing a finding from the timeline, the transcript, or a recommendation brings its entry into view; the entry's own
  // "Show in transcript" button does the reverse. Only a real timestamp ever moves the playhead.
  const selectFinding = useCallback((key: string) => {
    setSelected(key)
    requestAnimationFrame(() => scrollToFinding(key))
  }, [])
  const selectFromRecommendation = useCallback(
    (key: string) => {
      selectFinding(key)
      seekToFinding(key)
    },
    [selectFinding, seekToFinding],
  )
  const showInTranscript = useCallback((key: string) => {
    setSelected(key)
    requestAnimationFrame(() => scrollToMark(key))
  }, [])

  return (
    <PlaybackProvider controller={controller}>
      <div className="rise space-y-10">
        {/* The audio element only plays; the controls are the ones in the timeline. */}
        <audio ref={element} preload="metadata" hidden aria-hidden data-testid="playback-audio" />

        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 max-w-3xl">
            <p className="font-mono text-sm text-ink-3">{STATUS[report.status]}</p>
            <h1 className="mt-1 font-display text-4xl font-medium tracking-tight sm:text-5xl">Audio analysis</h1>
            <p className="mt-2 flex min-w-0 items-center gap-2 text-sm text-ink-2">
              <FileAudio className="size-4 shrink-0 text-ink-3" aria-hidden />
              <span className="truncate" title={meta.filename}>
                {meta.filename}
              </span>
            </p>
            <p className="mt-1 font-mono text-xs text-ink-3">
              {meta.format.toUpperCase()} · {formatDuration(meta.duration_seconds)} · {formatBytes(meta.size_bytes)}
            </p>
          </div>
          <button type="button" onClick={onReset} className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-accent">
            <RotateCcw className="size-4" aria-hidden />
            Analyze another
          </button>
        </header>

        {report.status !== 'complete' && (
          <div role="alert" className="flex items-start gap-3 border-l-2 border-amber-light bg-amber-tint/60 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden />
            <div>
              <p className="font-medium text-amber">{BANNERS[report.status]}</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-2">
                {report.errors.map((error) => (
                  <li key={`${error.component}-${error.code}`}>
                    {error.component}: {error.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <Overview report={report} groups={groups} />

        {report.status !== 'failed' && <NextStep plan={report.recommendations} onRetry={onRetry} />}

        <Timeline report={report} waveform={waveform} groups={groups} selected={selected} onSelect={selectFinding} onChooseAgain={onReset} />

        {/* Same order as the overview: what is said (the evidence you can act on) first, then how the voice sounds. */}
        <div className="grid gap-12 lg:grid-cols-[7fr_5fr] lg:gap-0">
          <div className="lg:pr-12">
            <IntentSection intent={report.intent} transcript={report.transcript} groups={groups} selected={selected} onSelect={selectFinding} onShowInTranscript={showInTranscript} />
          </div>
          <div className="lg:border-l lg:border-line lg:pl-12">
            <VoiceSection voice={report.voice} />
          </div>
        </div>

        <TranscriptWorkspace transcript={report.transcript} indicators={report.intent.indicators} selected={selected} onSelect={selectFinding} />
        {/* With nothing to act on, the summary at the top already says what this section would. A failed analysis has no summary there, so it keeps this one for its retry button. */}
        {(report.recommendations.state === 'actions' || report.status === 'failed') && (
          <RecommendationsSection
            plan={report.recommendations}
            knownFindings={knownFindings}
            onSelectFinding={selectFromRecommendation}
            onShowVoice={() => scrollToId('voice-heading')}
            onRetry={onRetry}
          />
        )}
        <UnderstandingResults />

        <p className="text-center text-sm text-ink-3">
          Temporary copies of the audio are deleted from the server after analysis, and neither audio nor transcript is kept. Playback uses the copy in your browser, which is released when you leave this page.
          {note && ` ${note}`}
        </p>
      </div>
    </PlaybackProvider>
  )
}

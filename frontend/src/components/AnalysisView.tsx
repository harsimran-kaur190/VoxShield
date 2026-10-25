import { Check, Circle, Loader2, X, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

import { STAGES, type Progress, type WaveformState } from '../hooks/useAnalysis'
import { formatBytes, formatDuration } from '../lib/format'
import { Waveform } from './Waveform'

const SLOW_AFTER_SECONDS = 15

interface Props {
  fileName: string
  fileSize: number
  waveform: WaveformState
  progress: Progress
  startedAt: number
  onCancel: () => void
}

export function AnalysisView({ fileName, fileSize, waveform, progress, startedAt, onCancel }: Props) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500)
    return () => clearInterval(timer)
  }, [startedAt])

  return (
    <section aria-label="Analysis in progress" className="rise">
      <p className="font-mono text-sm text-ink-3">Analyzing</p>
      <h1 className="mt-1 break-words font-display text-3xl font-medium sm:text-4xl">{fileName}</h1>
      <p className="mt-2 font-mono text-sm text-ink-3">
        {formatBytes(fileSize)}
        {waveform && ` · ${formatDuration(waveform.duration)}`}
      </p>

      <div className="on-stage mt-8 rounded-3xl bg-stage p-6 text-stage-ink ring-1 ring-stage-line sm:p-8">
        <div className="h-28 text-accent-light">
          {waveform ? (
            <Waveform peaks={waveform.peaks} className="h-full w-full" />
          ) : waveform === undefined ? (
            <div className="relative h-full overflow-hidden rounded-xl bg-stage-2" role="status" aria-label="Reading waveform">
              <div className="absolute inset-0 animate-[sweep_1.6s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-stage-line to-transparent" />
            </div>
          ) : (
            <p className="grid h-full place-items-center text-center text-sm text-stage-muted">
              Your browser can&apos;t draw a preview for this file. The analysis is not affected.
            </p>
          )}
        </div>
      </div>

      <ol className="mt-8 divide-y divide-line border-y border-line" aria-live="polite">
        {STAGES.map(({ id, label, detail }) => {
          const state = progress[id]
          return (
            <li key={id} className="flex items-center gap-4 py-4">
              <span className="grid size-6 place-items-center">
                {state === 'done' && <Check className="size-5 text-ok" aria-hidden />}
                {state === 'running' && <Loader2 className="size-5 animate-spin text-accent" aria-hidden />}
                {state === 'failed' && <XCircle className="size-5 text-danger" aria-hidden />}
                {state === 'pending' && <Circle className="size-4 text-line-strong" aria-hidden />}
              </span>
              <span className="flex-1">
                <span className={`block font-medium ${state === 'pending' ? 'text-ink-3' : 'text-ink'}`}>{label}</span>
                <span className="block text-sm text-ink-3">{detail}</span>
              </span>
              <span className="text-sm text-ink-3">
                {state === 'running' ? 'In progress' : state === 'done' ? 'Done' : state === 'failed' ? 'Unavailable' : 'Waiting'}
              </span>
            </li>
          )
        })}
      </ol>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-xl text-sm text-ink-3" aria-live="polite">
          {elapsed >= SLOW_AFTER_SECONDS
            ? 'Still working. The first analysis after the server starts also loads the models, and long recordings take longer.'
            : 'Audio is held in a temporary file on the server and deleted when this finishes.'}{' '}
          <span className="font-mono">{elapsed}s</span>
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-sm hover:bg-paper-2"
        >
          <X className="size-4" aria-hidden />
          Cancel
        </button>
      </div>
    </section>
  )
}

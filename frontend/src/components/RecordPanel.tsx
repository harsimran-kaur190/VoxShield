import { AlertTriangle, Loader2, Mic, RotateCcw, Square, Trash2, Upload } from 'lucide-react'

import { formatBytes } from '../lib/format'
import { formatTimestamp } from '../lib/highlight'
import { LEVEL_BARS, type RecorderSnapshot } from '../lib/recorderSession'
import { buttonClass } from './ui/styles'
import { Waveform } from './Waveform'

interface Props {
  snapshot: RecorderSnapshot
  maxSeconds: number
  onStart: () => void
  onStop: () => void
  onDiscard: () => void
  onAnalyze: () => void
  onUseUpload: () => void
}

const PRIMARY = buttonClass({ size: 'lg' })
const SECONDARY = buttonClass({ variant: 'secondary', size: 'lg' })

export function RecordPanel({ snapshot, maxSeconds, onStart, onStop, onDiscard, onAnalyze, onUseUpload }: Props) {
  const { status, elapsed, levels, error, result } = snapshot
  const remaining = Math.max(0, Math.ceil(maxSeconds - elapsed))
  const padded = [...Array<number>(Math.max(0, LEVEL_BARS - levels.length)).fill(0), ...levels]

  return (
    <div className="flex min-h-[20rem] flex-col justify-between gap-6 p-6 sm:p-8">
      <p className="sr-only" role="status" aria-live="polite">
        {status === 'recording' ? 'Recording started' : status === 'ready' ? 'Recording ready to review' : status === 'error' ? error?.message : ''}
      </p>

      {status === 'idle' && (
        <>
          <div className="flex h-20 items-center gap-[3px]" aria-hidden>
            {Array.from({ length: 72 }, (_, i) => (
              <span key={i} className="h-1 w-full rounded-full bg-stage-line" />
            ))}
          </div>
          <div>
            <p className="font-display text-2xl font-medium sm:text-3xl">Record with your microphone</p>
            <p className="mt-1 text-sm text-stage-muted">
              Up to {formatTimestamp(maxSeconds)}. Your browser asks for microphone access only when you press Start, and nothing is sent until you press Analyze.
            </p>
            <p className="mt-2 text-sm text-stage-muted">
              It captures sound your device’s microphone can hear, such as a call on speakerphone. It can’t record a phone call’s audio directly.
            </p>
            <button type="button" onClick={onStart} className={`${PRIMARY} mt-5`}>
              <Mic className="size-4" aria-hidden />
              Start recording
            </button>
          </div>
        </>
      )}

      {status === 'requesting' && (
        <div className="grid flex-1 place-items-center text-center" role="status">
          <div>
            <Loader2 className="mx-auto size-7 animate-spin text-accent-light" aria-hidden />
            <p className="mt-4 font-display text-2xl">Waiting for microphone access</p>
            <p className="mt-1 text-sm text-stage-muted">Choose Allow in the browser prompt.</p>
          </div>
        </div>
      )}

      {status === 'recording' && (
        <>
          <div className="flex items-center justify-between">
            <p className="inline-flex items-center gap-2 text-sm font-medium">
              <span className="size-2.5 animate-pulse rounded-full bg-rec" aria-hidden />
              Recording · microphone is on
            </p>
            <p className="font-mono text-sm tabular-nums" role="timer" aria-label={`Elapsed ${formatTimestamp(elapsed)}`}>
              {formatTimestamp(elapsed)} <span className="text-stage-muted">/ {formatTimestamp(maxSeconds)}</span>
            </p>
          </div>
          <div className="h-24 text-accent-light" role="img" aria-label="Live microphone level">
            <Waveform peaks={padded} className="h-full w-full" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <button type="button" onClick={onStop} className={SECONDARY}>
              <Square className="size-4 fill-current text-rec" aria-hidden />
              Stop recording
            </button>
            <p className={`text-sm ${remaining <= 10 ? 'text-amber-light' : 'text-stage-muted'}`}>{remaining}s remaining</p>
          </div>
        </>
      )}

      {status === 'processing' && (
        <div className="grid flex-1 place-items-center text-center" role="status">
          <div>
            <Loader2 className="mx-auto size-7 animate-spin text-accent-light" aria-hidden />
            <p className="mt-4 font-display text-2xl">Preparing your recording</p>
          </div>
        </div>
      )}

      {status === 'ready' && result && (
        <>
          <div>
            <div className="flex items-center justify-between text-sm text-stage-muted">
              <span>Review your recording</span>
              <span className="font-mono">
                {formatTimestamp(result.duration)} · {formatBytes(result.blob.size)}
              </span>
            </div>
            <div className="mt-3 h-20 text-accent-light" aria-hidden>
              <Waveform peaks={result.peaks} className="h-full w-full" />
            </div>
            <audio controls src={result.url} className="mt-3 w-full" aria-label="Playback of your recording" />
            {result.interrupted && (
              <p className="mt-3 text-sm text-amber-light">The microphone stopped on its own. This is what was captured before that.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onAnalyze} className={PRIMARY}>
              Analyze recording
            </button>
            <button type="button" onClick={onStart} className={SECONDARY}>
              <RotateCcw className="size-4" aria-hidden />
              Record again
            </button>
            <button type="button" onClick={onDiscard} className={SECONDARY}>
              <Trash2 className="size-4" aria-hidden />
              Discard
            </button>
          </div>
        </>
      )}

      {status === 'error' && error && (
        <div className="flex flex-1 flex-col justify-between gap-6" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-light" aria-hidden />
            <div>
              <p className="font-display text-2xl font-medium">{error.code === 'denied' ? 'Microphone blocked' : 'Recording problem'}</p>
              <p className="mt-2 text-stage-muted">{error.message}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {error.code !== 'unsupported' && (
              <button type="button" onClick={onStart} className={PRIMARY}>
                <Mic className="size-4" aria-hidden />
                Try again
              </button>
            )}
            <button type="button" onClick={onUseUpload} className={SECONDARY}>
              <Upload className="size-4" aria-hidden />
              Upload a file instead
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

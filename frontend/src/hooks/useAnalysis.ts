import { useCallback, useEffect, useRef, useState } from 'react'

import { analyzeAudio, ApiError, type Limits } from '../lib/api'
import { RunTracker } from '../lib/runTracker'
import type { AnalysisReport, Stage, StageState } from '../lib/types'
import { decodeWaveform, type Waveform } from '../lib/waveform'

export const STAGES: { id: Stage; label: string; detail: string }[] = [
  { id: 'decode', label: 'Reading audio', detail: 'Decoding to 16 kHz mono' },
  { id: 'transcription', label: 'Transcribing speech', detail: 'Whisper speech-to-text' },
  { id: 'voice', label: 'Checking voice authenticity', detail: 'Scoring windows of the recording' },
  { id: 'intent', label: 'Looking for scam indicators', detail: 'Checking the transcript sentence by sentence' },
]

export type Progress = Record<Stage, StageState>
const initialProgress = (): Progress => ({ decode: 'pending', transcription: 'pending', voice: 'pending', intent: 'pending' })

/** undefined while the browser is still decoding, null when this browser cannot draw the file. */
export type WaveformState = Waveform | null | undefined

export type AnalysisState =
  | { phase: 'idle' }
  | { phase: 'running'; fileName: string; fileSize: number; waveform: WaveformState; progress: Progress; startedAt: number }
  /** `audio` is the user's own file or recording, kept in memory only so it can be played back in this results view. */
  | { phase: 'done'; report: AnalysisReport; waveform: WaveformState; audio: File | null }
  | { phase: 'error'; message: string; canRetry: boolean }

export function useAnalysis(limits: Limits | null) {
  const [state, setState] = useState<AnalysisState>({ phase: 'idle' })
  const [tracker] = useState(() => new RunTracker())
  const fileRef = useRef<File | null>(null)
  const waveformRef = useRef<WaveformState>(undefined)

  // Leaving the page abandons the analysis: abort the request so the server stops after its current stage.
  useEffect(() => () => tracker.cancel(), [tracker])

  const start = useCallback(
    async (file: File) => {
      if (limits) {
        const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`
        if (!limits.allowed_extensions.includes(extension)) {
          setState({ phase: 'error', canRetry: false, message: `Unsupported file type. Allowed: ${limits.allowed_extensions.join(', ')}.` })
          return
        }
        if (file.size > limits.max_upload_mb * 1024 * 1024) {
          setState({ phase: 'error', canRetry: false, message: `File exceeds the ${limits.max_upload_mb} MB limit.` })
          return
        }
      }
      const run = tracker.begin()
      fileRef.current = file
      waveformRef.current = undefined
      setState({
        phase: 'running',
        fileName: file.name,
        fileSize: file.size,
        waveform: undefined,
        progress: initialProgress(),
        startedAt: Date.now(),
      })

      void decodeWaveform(file).then((waveform) => {
        if (!run.isCurrent()) return
        waveformRef.current = waveform
        setState((current) => (current.phase === 'running' || current.phase === 'done' ? { ...current, waveform } : current))
      })

      try {
        const report = await analyzeAudio(
          file,
          (stage, stageState) =>
            setState((current) =>
              current.phase === 'running' ? { ...current, progress: { ...current.progress, [stage]: stageState } } : current,
            ),
          run.signal,
        )
        if (run.isCurrent()) setState({ phase: 'done', report, waveform: waveformRef.current, audio: file })
      } catch (error) {
        if (run.signal.aborted) return
        setState({
          phase: 'error',
          canRetry: true,
          message: error instanceof ApiError ? error.message : 'Something went wrong while analyzing the file.',
        })
      }
    },
    [limits, tracker],
  )

  const retry = useCallback(() => {
    if (fileRef.current) void start(fileRef.current)
  }, [start])

  /** Aborts the request. The server stops after the stage it is currently running. */
  const reset = useCallback(() => {
    tracker.cancel()
    fileRef.current = null
    setState({ phase: 'idle' })
  }, [tracker])

  return { state, start, retry, reset }
}

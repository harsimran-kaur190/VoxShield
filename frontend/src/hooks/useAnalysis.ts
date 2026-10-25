import { useCallback, useRef, useState } from 'react'

import { analyzeAudio, ApiError, type Limits } from '../lib/api'
import type { AnalysisReport, Stage, StageState } from '../lib/types'
import { decodeWaveform, type Waveform } from '../lib/waveform'

export const STAGES: { id: Stage; label: string; detail: string }[] = [
  { id: 'decode', label: 'Reading audio', detail: 'Decoding to 16 kHz mono' },
  { id: 'transcription', label: 'Transcribing speech', detail: 'Whisper speech-to-text' },
  { id: 'voice', label: 'Checking voice authenticity', detail: 'Scoring windows of the recording' },
  { id: 'intent', label: 'Looking for scam indicators', detail: 'Applying the transcript rules' },
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
  const controllerRef = useRef<AbortController | null>(null)
  const fileRef = useRef<File | null>(null)
  const runRef = useRef(0)
  const waveformRef = useRef<WaveformState>(undefined)

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
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      fileRef.current = file
      const run = ++runRef.current
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
        if (runRef.current !== run) return
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
          controller.signal,
        )
        if (runRef.current === run) setState({ phase: 'done', report, waveform: waveformRef.current, audio: file })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({
          phase: 'error',
          canRetry: true,
          message: error instanceof ApiError ? error.message : 'Something went wrong while analyzing the file.',
        })
      }
    },
    [limits],
  )

  const retry = useCallback(() => {
    if (fileRef.current) void start(fileRef.current)
  }, [start])

  /** Aborts the request. The server stops after the stage it is currently running. */
  const reset = useCallback(() => {
    controllerRef.current?.abort()
    runRef.current++
    fileRef.current = null
    setState({ phase: 'idle' })
  }, [])

  return { state, start, retry, reset }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { analyzeAudio, ApiError, type Limits } from '../lib/api'
import { addEntry, type AnalysisEntry } from '../lib/history'
import { DEFAULT_LANGUAGE, type LanguageChoice } from '../lib/languages'
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
  | { phase: 'running'; fileName: string; fileSize: number; waveform: WaveformState; progress: Progress; startedAt: number; language: LanguageChoice }
  /**
   * `audio` is the user's own file or recording, kept in memory only so it can be played back in this results view.
   * `entryId` is this report's place in the session history, where its forensic report can be reopened.
   */
  | { phase: 'done'; report: AnalysisReport; waveform: WaveformState; audio: File | null; entryId: string }
  | { phase: 'error'; message: string; canRetry: boolean }

/**
 * Whether choosing this page again from the navigation (for example "Analyze Audio" while a result is showing) should
 * return to the empty form. A finished or failed analysis does; a running one keeps going, since it has its own Cancel.
 */
export const startsOverOnRenavigation = (phase: AnalysisState['phase']) => phase === 'done' || phase === 'error'

/**
 * Re-selecting the current route keeps the page mounted, so its state would otherwise stay on screen and the link would
 * appear to do nothing. Each navigation gets a new location key, which is what this watches.
 */
export function useStartOverOnRenavigation(phase: AnalysisState['phase'], startOver: () => void) {
  const { key } = useLocation()
  const seen = useRef(key)
  useEffect(() => {
    if (seen.current === key) return
    seen.current = key
    if (startsOverOnRenavigation(phase)) startOver()
  }, [key, phase, startOver])
}

/** Where the audio came from, for the history entry. A Lab sample carries its scenario title. */
export type AnalysisOrigin = { source: AnalysisEntry['source']; title?: string }
const UPLOAD: AnalysisOrigin = { source: 'upload' }

export function useAnalysis(limits: Limits | null) {
  const [state, setState] = useState<AnalysisState>({ phase: 'idle' })
  const [tracker] = useState(() => new RunTracker())
  const fileRef = useRef<File | null>(null)
  const languageRef = useRef<LanguageChoice>(DEFAULT_LANGUAGE)
  const originRef = useRef<AnalysisOrigin>(UPLOAD)
  const waveformRef = useRef<WaveformState>(undefined)

  // Leaving the page abandons the analysis: abort the request so the server stops after its current stage.
  useEffect(() => () => tracker.cancel(), [tracker])

  const start = useCallback(
    async (file: File, language: LanguageChoice = DEFAULT_LANGUAGE, origin: AnalysisOrigin = UPLOAD) => {
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
      languageRef.current = language
      originRef.current = origin
      waveformRef.current = undefined
      setState({
        phase: 'running',
        fileName: file.name,
        fileSize: file.size,
        waveform: undefined,
        progress: initialProgress(),
        startedAt: Date.now(),
        language,
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
          language,
        )
        if (!run.isCurrent()) return
        // Every report the backend returns is recorded as it is, including partial and failed ones. A request that
        // never produced a report (network error, cancel) is not.
        const entry = addEntry({ kind: 'analysis', source: origin.source, title: origin.title ?? report.audio.filename ?? file.name, report })
        setState({ phase: 'done', report, waveform: waveformRef.current, audio: file, entryId: entry.id })
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
    // The same file and the same language the user chose, so a retry is the same request.
    if (fileRef.current) void start(fileRef.current, languageRef.current, originRef.current)
  }, [start])

  /** Aborts the request. The server stops after the stage it is currently running. */
  const reset = useCallback(() => {
    tracker.cancel()
    fileRef.current = null
    setState({ phase: 'idle' })
  }, [tracker])

  return { state, start, retry, reset }
}

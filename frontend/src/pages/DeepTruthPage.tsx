import { Loader2, Lock } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { DeepTruthResult } from '../components/deeptruth/DeepTruthResult'
import { MediaDropzone } from '../components/deeptruth/MediaDropzone'
import { ErrorNotice } from '../components/ErrorNotice'
import { ApiError } from '../lib/api'
import { analyzeMedia, getDeepTruthLimits, guessKind, type DeepTruthLimits, type DeepTruthReport } from '../lib/deeptruth'
import { formatBytes } from '../lib/format'
import { addEntry } from '../lib/history'

type State =
  | { phase: 'idle' }
  | { phase: 'running'; file: File }
  | { phase: 'done'; report: DeepTruthReport; file: File }
  | { phase: 'error'; message: string; canRetry: boolean }

export function DeepTruthPage() {
  const [limits, setLimits] = useState<DeepTruthLimits | null>(null)
  const [state, setState] = useState<State>({ phase: 'idle' })
  const fileRef = useRef<File | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getDeepTruthLimits(controller.signal).then(setLimits).catch(() => setLimits(null))
    return () => controller.abort()
  }, [])
  // Leaving the page abandons the request.
  useEffect(() => () => controllerRef.current?.abort(), [])

  const start = useCallback(
    async (file: File) => {
      if (limits && file.size > limits.max_upload_mb * 1024 * 1024) {
        setState({ phase: 'error', canRetry: false, message: `File exceeds the ${limits.max_upload_mb} MB limit.` })
        return
      }
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      fileRef.current = file
      setState({ phase: 'running', file })
      try {
        const report = await analyzeMedia(file, controller.signal)
        if (controller.signal.aborted) return
        addEntry({ kind: 'deeptruth', source: 'upload', title: report.media.filename || file.name, report }) // reopenable from History
        setState({ phase: 'done', report, file })
      } catch (error) {
        if (controller.signal.aborted) return
        const api = error instanceof ApiError ? error : null
        // A detected-but-unbuilt modality is a limit of this build, so retrying the same file is pointless.
        const canRetry = !api || !['modality_not_supported_yet', 'unsupported_extension', 'unrecognized_media', 'file_too_large'].includes(api.code)
        setState({ phase: 'error', canRetry, message: api?.message ?? 'Something went wrong while analyzing the file.' })
      }
    },
    [limits],
  )
  const reset = useCallback(() => {
    controllerRef.current?.abort()
    fileRef.current = null
    setState({ phase: 'idle' })
  }, [])
  const retry = useCallback(() => {
    if (fileRef.current) void start(fileRef.current)
  }, [start])

  if (state.phase === 'done') return <DeepTruthResult report={state.report} file={state.file} onReset={reset} />

  return (
    <div>
      <section className="grid items-center gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-6">
          <p className="font-mono text-sm text-ink-3">DeepTruth · multimodal deepfake detection</p>
          <h1 className="mt-5 font-display text-5xl font-medium leading-[1.04] tracking-tight sm:text-6xl">
            One file in.
            <span className="block italic text-accent">Evidence out.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg text-ink-2">
            Drop an image, an audio clip or a video. DeepTruth works out what it is, runs the matching forensic modules, and reports a manipulation likelihood with the evidence behind it and what it could not check.
          </p>
          <p className="mt-6 flex max-w-lg items-start gap-2 text-sm text-ink-3">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            The server deletes the file when the analysis ends and stores nothing.
          </p>
          {limits && limits.supported_kinds.length < 3 && (
            <p className="mt-4 text-sm text-ink-3">
              This build analyzes {limits.supported_kinds.join(' and ')} today. Other types are detected and reported as not yet supported.
            </p>
          )}
        </div>
        <div className="space-y-4 lg:col-span-6">
          {state.phase === 'error' && (
            <ErrorNotice title={state.canRetry ? "The analysis couldn't finish" : "We can't analyze that file yet"} message={state.message} onRetry={state.canRetry ? retry : undefined} onDismiss={reset} dismissLabel="Dismiss" />
          )}
          {state.phase === 'running' ? (
            <div className="on-stage flex min-h-[20rem] flex-col justify-center gap-3 rounded-card border border-line bg-stage p-8 text-stage-ink shadow-raised" role="status" aria-live="polite">
              <Loader2 className="size-6 animate-spin text-accent" aria-hidden />
              <p className="font-display text-2xl font-medium">Analyzing {state.file.name}</p>
              <p className="font-mono text-sm text-stage-muted">
                {formatBytes(state.file.size)}
                {guessKind(state.file) && ` · looks like ${guessKind(state.file)} (the server will confirm from the bytes)`}
              </p>
              <p className="text-sm text-stage-muted">
                The first analysis after a restart loads the models and can take a minute.
                {guessKind(state.file) === 'video' && ' A video is checked frame by frame for its first minute, then its audio track is checked, so it takes longer than a photo.'}
              </p>
            </div>
          ) : (
            <MediaDropzone limits={limits} onFile={start} />
          )}
        </div>
      </section>
    </div>
  )
}

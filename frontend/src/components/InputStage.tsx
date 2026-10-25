import { Mic, Upload } from 'lucide-react'
import { useId, useState, type KeyboardEvent } from 'react'

import { useRecorder } from '../hooks/useRecorder'
import type { Limits } from '../lib/api'
import { recordingToFile } from '../lib/recording'
import { RecordPanel } from './RecordPanel'
import { UploadStage } from './UploadStage'

type Mode = 'upload' | 'record'

const TABS: { id: Mode; label: string; icon: typeof Upload }[] = [
  { id: 'upload', label: 'Upload audio', icon: Upload },
  { id: 'record', label: 'Record audio', icon: Mic },
]

export function InputStage({ limits, onFile }: { limits: Limits | null; onFile: (file: File) => void }) {
  const id = useId()
  const [mode, setMode] = useState<Mode>('upload')
  const recorder = useRecorder(limits)
  const [submitted, setSubmitted] = useState(false)
  // Switching tabs would not stop a live recording, so it is not offered while the microphone is busy.
  const busy = ['requesting', 'recording', 'processing'].includes(recorder.snapshot.status)

  const analyze = () => {
    const result = recorder.snapshot.result
    if (!result || submitted) return // one submission per recording
    setSubmitted(true)
    onFile(recordingToFile(result))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (busy || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    setMode((current) => (current === 'upload' ? 'record' : 'upload'))
    event.preventDefault()
  }

  return (
    <div className="on-stage overflow-hidden rounded-3xl bg-stage text-stage-ink shadow-[0_30px_60px_-30px_rgba(13,16,23,0.55)] ring-1 ring-stage-line">
      <div role="tablist" aria-label="How do you want to add audio?" onKeyDown={onKeyDown} className="grid grid-cols-2 gap-1 border-b border-stage-line p-2">
        {TABS.map(({ id: tab, label, icon: Icon }) => {
          const selected = mode === tab
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`${id}-tab-${tab}`}
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              aria-disabled={busy && !selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => !busy && setMode(tab)}
              className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium transition ${
                selected ? 'bg-stage-2 text-stage-ink ring-1 ring-stage-line' : 'text-stage-muted hover:text-stage-ink'
              } ${busy && !selected ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${mode}`}>
        {mode === 'upload' ? (
          <UploadStage limits={limits} onFile={onFile} />
        ) : (
          <RecordPanel
            snapshot={recorder.snapshot}
            maxSeconds={recorder.maxSeconds}
            onStart={recorder.start}
            onStop={recorder.stop}
            onDiscard={recorder.discard}
            onAnalyze={analyze}
            onUseUpload={() => {
              recorder.discard()
              setMode('upload')
            }}
          />
        )}
      </div>
    </div>
  )
}

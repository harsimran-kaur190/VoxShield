import { FileAudio, Upload } from 'lucide-react'
import { useId, useRef, useState, type DragEvent } from 'react'

import type { Limits } from '../lib/api'

const TICKS = 72

export function UploadStage({ limits, onFile }: { limits: Limits | null; onFile: (file: File) => void }) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const pick = (files: FileList | null) => {
    const file = files?.[0]
    if (file) onFile(file)
    if (inputRef.current) inputRef.current.value = ''
  }
  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    pick(event.dataTransfer.files)
  }

  const formats = (limits?.allowed_extensions ?? ['.wav', '.mp3', '.m4a', '.flac', '.ogg']).map((ext) => ext.slice(1).toUpperCase())

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`relative flex min-h-[20rem] flex-col justify-between gap-6 p-6 transition sm:p-8 ${
        dragging ? 'bg-stage-2 ring-2 ring-inset ring-accent-light' : ''
      }`}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="sr-only"
        aria-label="Choose an audio file to analyze"
        accept={limits ? limits.allowed_extensions.join(',') : 'audio/*'}
        onChange={(event) => pick(event.target.files)}
      />
      <div className="flex items-center justify-between text-sm text-stage-muted">
        <span className="inline-flex items-center gap-2">
          <FileAudio className="size-4" aria-hidden />
          Audio file
        </span>
        <span className="font-mono text-xs">{formats.join(' · ')}</span>
      </div>

      {/* An empty baseline: this is where the recording's real waveform appears once a file is chosen. */}
      <div className="flex h-20 items-center gap-[3px]" aria-hidden>
        {Array.from({ length: TICKS }, (_, i) => (
          <span
            key={i}
            className={`w-full rounded-full transition-all duration-300 ${dragging ? 'bg-accent-light' : 'bg-stage-line'}`}
            style={{ height: dragging ? `${14 + ((i * 37) % 52)}%` : '4px' }}
          />
        ))}
      </div>

      <div>
        <p className="font-display text-2xl font-medium sm:text-3xl">{dragging ? 'Release to analyze' : 'Drop a call recording here'}</p>
        <p className="mt-1 text-sm text-stage-muted">
          {limits
            ? `Up to ${limits.max_upload_mb} MB, ${limits.min_duration_seconds} second to ${limits.max_duration_seconds / 60} minutes.`
            : 'Up to 25 MB, 1 second to 10 minutes.'}
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition hover:bg-accent-light hover:text-stage"
        >
          <Upload className="size-4" aria-hidden />
          Choose audio file
        </button>
      </div>
    </div>
  )
}

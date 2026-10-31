import { FileAudio, FileImage, FileVideo, Upload } from 'lucide-react'
import { useId, useRef, useState, type DragEvent } from 'react'

import type { DeepTruthLimits, MediaKind } from '../../lib/deeptruth'
import { buttonClass } from '../ui/styles'

const KINDS: { kind: MediaKind; label: string; icon: typeof FileImage }[] = [
  { kind: 'image', label: 'Image', icon: FileImage },
  { kind: 'audio', label: 'Audio', icon: FileAudio },
  { kind: 'video', label: 'Video', icon: FileVideo },
]

/** One drop box for every media type. The server reads the real type from the file's bytes. */
export function MediaDropzone({ limits, onFile, disabled }: { limits: DeepTruthLimits | null; onFile: (file: File) => void; disabled?: boolean }) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const pick = (files: FileList | null) => {
    const file = files?.[0]
    if (file && !disabled) onFile(file)
    if (inputRef.current) inputRef.current.value = ''
  }
  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    pick(event.dataTransfer.files)
  }
  const accept = limits ? Object.values(limits.extensions).flat().join(',') : 'image/*,audio/*,video/*'
  const supported = new Set(limits?.supported_kinds ?? ['audio'])

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`on-stage relative flex min-h-[20rem] flex-col justify-between gap-6 rounded-card border border-line bg-stage p-6 text-stage-ink shadow-raised transition sm:p-8 ${
        dragging ? 'bg-stage-2 ring-2 ring-inset ring-accent-light' : ''
      }`}
    >
      <input ref={inputRef} id={inputId} type="file" className="sr-only" aria-label="Choose an image, audio or video file to analyze" accept={accept} onChange={(event) => pick(event.target.files)} />

      <ul className="flex flex-wrap gap-2 text-sm text-stage-muted" aria-label="Accepted media types">
        {KINDS.map(({ kind, label, icon: Icon }) => (
          <li key={kind} className="inline-flex items-center gap-1.5 rounded-full border border-stage-line px-3 py-1">
            <Icon className="size-4" aria-hidden />
            {label}
            {!supported.has(kind) && <span className="font-mono text-[10px] uppercase tracking-wide opacity-70">soon</span>}
          </li>
        ))}
      </ul>

      <div>
        <p className="font-display text-2xl font-medium sm:text-3xl">{dragging ? 'Release to analyze' : 'Drop an image, audio clip or video here'}</p>
        <p className="mt-1 text-sm text-stage-muted">
          {limits ? `Up to ${limits.max_upload_mb} MB. The file type is detected from its contents, not its name.` : 'The file type is detected from its contents, not its name.'}
        </p>
        <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className={buttonClass({ size: 'lg', className: 'mt-5' })}>
          <Upload className="size-4" aria-hidden />
          Choose a file
        </button>
      </div>
    </div>
  )
}

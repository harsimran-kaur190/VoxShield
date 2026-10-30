import { ListChecks, ScrollText } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { TranscriptLine } from '../../lib/liveCall/types'
import { formatClock, SAFETY_STEPS } from '../../lib/liveCall/view'
import { Card, CardHeader } from '../ui/Card'

/** What the other person said, as transcribed from the analysed windows. Follows new lines unless the user scrolled up. */
export function TranscriptPanel({ lines, flagged = [], id }: { lines: TranscriptLine[]; flagged?: string[]; id?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [lines.length])
  const isFlagged = (text: string) => flagged.some((sentence) => sentence && (text.includes(sentence) || sentence.includes(text.trim())))

  return (
    <Card as="section" aria-labelledby={id}>
      <CardHeader id={id} title={<span className="inline-flex items-center gap-2"><ScrollText className="size-4 text-ink-3" aria-hidden />Other person’s transcript</span>} description="Machine transcription of their audio. It can contain mistakes." />
      <div
        ref={box}
        onScroll={(event) => {
          const el = event.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        tabIndex={0}
        aria-label="Transcript"
        className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1 text-sm"
      >
        {lines.length === 0 ? (
          <p className="text-ink-3">Nothing transcribed yet. Lines appear a few seconds after the other person speaks.</p>
        ) : (
          lines.map((line, index) => (
            <p key={`${line.start}-${index}`} className={`grid grid-cols-[3.5rem_1fr] gap-2 ${isFlagged(line.text) ? 'rounded-control bg-amber-tint/60 px-1 py-0.5' : ''}`}>
              <span className="font-mono text-xs leading-5 text-ink-3">{formatClock(line.start)}</span>
              <span className="text-ink">{line.text}</span>
            </p>
          ))
        )}
      </div>
    </Card>
  )
}

export function SafetySteps({ id }: { id?: string }) {
  return (
    <Card as="section" tone="muted" aria-labelledby={id}>
      <CardHeader id={id} title={<span className="inline-flex items-center gap-2"><ListChecks className="size-4 text-ink-3" aria-hidden />Safety steps</span>} description="General precautions for any call." />
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
        {SAFETY_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </Card>
  )
}

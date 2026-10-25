import { useEffect, useRef } from 'react'

import { usePlayback, usePlaybackState, usePlaybackTime } from '../../hooks/usePlayback'
import { buildPieces, CATEGORY_LABELS, formatTimestamp, indicatorKey } from '../../lib/highlight'
import { activeSegmentIndex } from '../../lib/playback'
import type { IntentIndicator, TranscriptResult } from '../../lib/types'
import { ModelNote } from '../ModelNote'
import { keepVisible } from './scroll'

interface Props {
  transcript: TranscriptResult
  indicators: IntentIndicator[]
  selected: string | null
  onSelect: (key: string) => void
}

export function TranscriptWorkspace({ transcript, indicators, selected, onSelect }: Props) {
  const controller = usePlayback()
  const state = usePlaybackState()
  const byKey = new Map(indicators.map((item) => [indicatorKey(item), item]))
  const hasReported = indicators.some((item) => item.context === 'reported')
  const canSeek = state.status === 'ready'
  // Re-renders only when the spoken segment changes, not on every playback frame.
  const active = usePlaybackTime((seconds) => activeSegmentIndex(transcript.segments, seconds))
  const list = useRef<HTMLDivElement>(null)
  const rows = useRef(new Map<number, HTMLLIElement>())

  useEffect(() => {
    const row = active !== null ? rows.current.get(active) : undefined
    if (row && list.current && controller?.getState().playing) keepVisible(list.current, row)
  }, [active, controller])

  return (
    <section aria-labelledby="transcript-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="transcript-heading" className="font-display text-3xl font-medium">
            Transcript
          </h2>
          <p className="mt-1 text-sm text-ink-3">
            {transcript.language && (
              <>
                Language: {transcript.language}
                {transcript.language_probability !== null && ` (${Math.round(transcript.language_probability * 100)}% detection score)`}
                {' · '}
              </>
            )}
            {canSeek ? 'Press a time to play from there.' : 'Playback is not available for this transcript.'}
          </p>
        </div>
        {indicators.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-4 text-sm text-ink-2">
            <span className="flex items-center gap-2">
              <span className="h-4 w-6 rounded bg-amber-tint ring-1 ring-amber-light" aria-hidden /> Matched phrase
            </span>
            {hasReported && (
              <span className="flex items-center gap-2">
                <span className="h-4 w-6 rounded bg-accent-tint ring-1 ring-accent-light" aria-hidden /> Reported speech
              </span>
            )}
          </p>
        )}
      </div>

      {transcript.status === 'ok' ? (
        <div ref={list} role="region" aria-label="Transcript text" tabIndex={0} className="relative mt-5 max-h-[32rem] overflow-y-auto rounded-2xl border border-line bg-card p-2 sm:p-4">
          <ol>
            {transcript.segments.map((segment) => {
              const isActive = active === segment.index
              return (
                <li
                  key={segment.index}
                  ref={(node) => {
                    if (node) rows.current.set(segment.index, node)
                    else rows.current.delete(segment.index)
                  }}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => canSeek && controller?.seek(segment.start_seconds)}
                  className={`grid grid-cols-[3.25rem_1fr] gap-3 rounded-lg border-l-2 px-2 py-3 transition-colors sm:grid-cols-[3.75rem_1fr] ${
                    isActive ? 'border-accent bg-accent-tint/60' : 'border-transparent'
                  } ${canSeek ? 'cursor-pointer' : ''}`}
                >
                  {canSeek ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        controller?.seek(segment.start_seconds)
                        void controller?.play()
                      }}
                      aria-label={`Play from ${formatTimestamp(segment.start_seconds)}`}
                      className="h-7 self-start rounded-md px-1.5 text-left font-mono text-xs text-accent-deep underline-offset-4 hover:bg-accent-tint hover:underline"
                    >
                      {formatTimestamp(segment.start_seconds)}
                    </button>
                  ) : (
                    <span className="pt-1 font-mono text-xs text-ink-3">{formatTimestamp(segment.start_seconds)}</span>
                  )}
                  <p className="text-lg leading-8">
                    {buildPieces(segment, indicators).map((piece, index) => {
                      if (piece.keys.length === 0) return <span key={index}>{piece.text}</span>
                      const items = piece.keys.map((key) => byKey.get(key)).filter((item): item is IntentIndicator => !!item)
                      const reported = items.every((item) => item.context === 'reported')
                      const chosen = selected !== null && piece.keys.includes(selected)
                      const primary = chosen && selected ? selected : piece.keys[0]
                      const labels = [...new Set(items.map((item) => CATEGORY_LABELS[item.category] ?? item.category))].join(', ')
                      return (
                        <span
                          key={index}
                          role="button"
                          tabIndex={0}
                          data-marks={piece.keys.join(' ')}
                          onClick={(event) => {
                            event.stopPropagation()
                            onSelect(primary)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              onSelect(primary)
                            }
                          }}
                          aria-pressed={chosen}
                          title={labels}
                          className={`cursor-pointer rounded px-0.5 ring-1 transition [box-decoration-break:clone] ${
                            reported ? 'bg-accent-tint ring-accent-light' : 'bg-amber-tint ring-amber-light'
                          } ${chosen ? 'ring-2 ring-ink' : ''}`}
                        >
                          {piece.text}
                          <span className="sr-only"> (flagged: {labels})</span>
                        </span>
                      )
                    })}
                  </p>
                </li>
              )
            })}
          </ol>
        </div>
      ) : (
        <p className="mt-5 rounded-2xl border border-line bg-card p-5 text-ink-2">
          {transcript.status === 'no_speech'
            ? 'No speech was detected in this recording, so there is no transcript and the scam check was not applied.'
            : (transcript.error ?? 'The transcript is unavailable.')}
        </p>
      )}
      {transcript.quality_notes.map((note) => (
        <p key={note} className="mt-3 text-sm text-amber">
          {note}
        </p>
      ))}
      <ModelNote model={transcript.model} />
    </section>
  )
}

import { useEffect, useRef } from 'react'

import { usePlayback, usePlaybackState, usePlaybackTime } from '../../hooks/usePlayback'
import { hasUsableTiming } from '../../lib/evidence'
import { languageLine } from '../../lib/languages'
import { buildPieces, CATEGORY_LABELS, formatTimestamp, indicatorKey, inTranslation } from '../../lib/highlight'
import { activeSegmentIndex } from '../../lib/playback'
import type { IntentIndicator, LanguageInfo, TranscriptResult, TranscriptSegment } from '../../lib/types'
import { ModelNote } from '../ModelNote'
import { keepVisible } from './scroll'

interface Props {
  transcript: TranscriptResult
  language?: LanguageInfo | null
  /** The English translation scam detection read, for Hindi or Urdu speech. */
  translation?: TranscriptResult | null
  indicators: IntentIndicator[]
  selected: string | null
  onSelect: (key: string) => void
}

interface ListProps {
  label: string
  segments: TranscriptSegment[]
  indicators: IntentIndicator[]
  canSeek: boolean
  selected: string | null
  onSelect: (key: string) => void
}

/** One scrollable list of timed segments with the matched phrases marked. Used for the transcript and its translation. */
function SegmentList({ label, segments, indicators, canSeek, selected, onSelect }: ListProps) {
  const controller = usePlayback()
  const byKey = new Map(indicators.map((item) => [indicatorKey(item), item]))
  // Re-renders only when the spoken segment changes, not on every playback frame.
  const active = usePlaybackTime((seconds) => activeSegmentIndex(segments, seconds))
  const list = useRef<HTMLDivElement>(null)
  const rows = useRef(new Map<number, HTMLLIElement>())

  useEffect(() => {
    const row = active !== null ? rows.current.get(active) : undefined
    if (row && list.current && controller?.getState().playing) keepVisible(list.current, row)
  }, [active, controller])

  return (
    <div ref={list} role="region" aria-label={label} tabIndex={0} className="relative mt-5 max-h-[32rem] overflow-y-auto rounded-card border border-line bg-card p-2 sm:p-4">
      <ol>
        {segments.map((segment) => {
          const isActive = active === segment.index
          const seekable = canSeek && hasUsableTiming(segment)
          return (
            <li
              key={segment.index}
              ref={(node) => {
                if (node) rows.current.set(segment.index, node)
                else rows.current.delete(segment.index)
              }}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => seekable && controller?.seek(segment.start_seconds)}
              className={`grid grid-cols-[3.25rem_1fr] gap-3 rounded-lg border-l-2 px-2 py-3 transition-colors sm:grid-cols-[3.75rem_1fr] ${
                isActive ? 'border-accent bg-accent-tint/60' : 'border-transparent'
              } ${seekable ? 'cursor-pointer' : ''}`}
            >
              {seekable ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    controller?.seek(segment.start_seconds)
                    void controller?.play()
                  }}
                  aria-label={`Play from ${formatTimestamp(segment.start_seconds)}`}
                  className="h-7 self-start rounded-md px-1.5 pointer-coarse:h-11 text-left font-mono text-xs text-accent-deep underline-offset-4 hover:bg-accent-tint hover:underline"
                >
                  {formatTimestamp(segment.start_seconds)}
                </button>
              ) : (
                <span className="pt-1 font-mono text-xs text-ink-3">{hasUsableTiming(segment) ? formatTimestamp(segment.start_seconds) : '–:––'}</span>
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
  )
}

function Translation({ translation, language, indicators, canSeek, selected, onSelect }: { translation: TranscriptResult; language?: LanguageInfo | null } & Omit<ListProps, 'label' | 'segments'>) {
  const from = language?.name ?? 'the original language'
  return (
    <div className="mt-10" data-testid="translation">
      <h3 id="translation-heading" className="font-display text-2xl font-medium">
        English translation
      </h3>
      <p className="mt-1 text-sm text-ink-3">
        Machine translation from {from}, made by the speech-to-text model from the audio. Scam detection read this text. It is not what was said: the transcript above is.
      </p>
      {(translation.quality_notes.length > 0 || language?.translation_note) && (
        <div role="note" className="mt-4 border-l-2 border-amber-light pl-4 text-sm text-ink-2">
          <p className="font-medium text-amber">Translation warning</p>
          <ul className="mt-1 space-y-1">
            {[...(language?.translation_note ? [language.translation_note] : []), ...translation.quality_notes].map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      {translation.status === 'ok' && translation.segments.length > 0 ? (
        <SegmentList label="English translation text" segments={translation.segments} indicators={indicators} canSeek={canSeek} selected={selected} onSelect={onSelect} />
      ) : (
        <p className="mt-5 rounded-card border border-line bg-card p-5 text-ink-2">
          {translation.status === 'ok'
            ? translation.text || 'The translation is empty.'
            : (translation.error ?? 'No English translation could be made, so only the Hindi keyword rules were applied to the original transcript.')}
        </p>
      )}
      <ModelNote model={translation.model} />
    </div>
  )
}

export function TranscriptWorkspace({ transcript, language, translation, indicators, selected, onSelect }: Props) {
  const state = usePlaybackState()
  const original = indicators.filter((item) => !inTranslation(item))
  const translated = indicators.filter(inTranslation)
  const hasReported = indicators.some((item) => item.context === 'reported')
  const hasTimes = transcript.segments.some(hasUsableTiming)
  const canSeek = state.status === 'ready' && hasTimes

  return (
    <section aria-labelledby="transcript-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="transcript-heading" className="font-display text-3xl font-medium">
            Transcript
          </h2>
          <p className="mt-1 text-sm text-ink-3">
            {language?.code ? (
              <>Original-language transcript, not translated. Language: {languageLine(language)} · </>
            ) : (
              transcript.language && (
                <>
                  Language: {transcript.language}
                  {transcript.language_probability !== null && ` (${Math.round(transcript.language_probability * 100)}% detection score)`}
                  {' · '}
                </>
              )
            )}
            {!hasTimes
              ? 'This transcript has no timestamps, so it cannot be linked to the audio.'
              : canSeek
                ? 'Press a time to play from there. Times come from the speech-to-text segments.'
                : 'Playback is not available for this transcript.'}
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

      {(transcript.quality_notes.length > 0 || language?.transcription_note) && (
        <div role="note" className="mt-4 border-l-2 border-amber-light pl-4 text-sm text-ink-2">
          <p className="font-medium text-amber">Transcription warning</p>
          <ul className="mt-1 space-y-1">
            {[...transcript.quality_notes, ...(language?.transcription_note ? [language.transcription_note] : [])].map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          {indicators.length > 0 && <p className="mt-1 text-ink-3">Scam indicators are found in this text, so a misheard word can change what is flagged.</p>}
        </div>
      )}
      {transcript.status === 'ok' && transcript.segments.length === 0 ? (
        <div className="mt-5 rounded-card border border-line bg-card p-5">
          <p className="text-sm text-ink-3">The transcript came back without segments, so nothing can be highlighted or linked to the audio. Plain text:</p>
          <p className="mt-3 text-lg leading-8">{transcript.text || 'The transcript is empty.'}</p>
        </div>
      ) : transcript.status === 'ok' ? (
        <SegmentList label="Transcript text" segments={transcript.segments} indicators={original} canSeek={canSeek} selected={selected} onSelect={onSelect} />
      ) : (
        <p className="mt-5 rounded-card border border-line bg-card p-5 text-ink-2">
          {transcript.status === 'no_speech'
            ? 'No speech was detected in this recording, so there is no transcript and the scam check was not applied.'
            : (transcript.error ?? 'The transcript is unavailable.')}
        </p>
      )}
      <ModelNote model={transcript.model} />

      {translation && <Translation translation={translation} language={language} indicators={translated} canSeek={canSeek} selected={selected} onSelect={onSelect} />}
    </section>
  )
}

import { ArrowDownToLine, Play } from 'lucide-react'

import { usePlayback, usePlaybackState } from '../../hooks/usePlayback'
import { findingCaveats, findingSource, sharedFindingNotes } from '../../lib/evidence'
import { CATEGORY_LABELS, formatTimestamp, inTranslation, segmentOf, segmentsFor } from '../../lib/highlight'
import { findingSeekTime, type FindingGroup } from '../../lib/playback'
import { languageName, scamLanguageNotice, scamTranslationNotice } from '../../lib/languages'
import type { IntentAssessment, LanguageInfo, TranscriptResult } from '../../lib/types'
import { Limitations, ModelNote } from '../ModelNote'

const SEVERITY = {
  high: { label: 'High signal', dot: 'bg-critical' },
  medium: { label: 'Medium signal', dot: 'bg-amber-light' },
  low: { label: 'Low signal', dot: 'bg-line-strong' },
} as const

interface Props {
  intent: IntentAssessment
  transcript: TranscriptResult
  language?: LanguageInfo | null
  translation?: TranscriptResult | null
  groups: FindingGroup[]
  selected: string | null
  onSelect: (key: string) => void
  onShowInTranscript: (key: string) => void
}

function Entry({ group, transcript, translation, language, active, onSelect, onShowInTranscript }: { group: FindingGroup; transcript: TranscriptResult; active: boolean } & Pick<Props, 'translation' | 'language' | 'onSelect' | 'onShowInTranscript'>) {
  const controller = usePlayback()
  const state = usePlaybackState()
  const reported = group.context === 'reported'
  const seekTime = findingSeekTime({ start_seconds: group.start_seconds })
  const canPlay = seekTime !== null && state.status === 'ready'
  const first = group.items[0]
  const translated = inTranslation(first)
  const located = segmentOf(first, segmentsFor(first, transcript, translation)) !== undefined
  const severity = SEVERITY[group.severity]
  const categories = [...new Set(group.items.map((item) => CATEGORY_LABELS[item.category] ?? item.category))]
  const caveats = [...new Set(group.items.flatMap((item) => findingCaveats(item, segmentOf(item, segmentsFor(item, transcript, translation)))))]
  const spoken = language?.name ?? languageName(transcript.language) ?? 'original language'
  const original = translated ? first.original_text : null

  return (
    <li
      data-finding-ids={group.ids.join(' ')}
      aria-current={active ? 'true' : undefined}
      className={`-mx-3 px-3 py-5 transition-colors ${active ? 'bg-accent-tint/70' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        {seekTime !== null ? (
          canPlay ? (
            <button
              type="button"
              onClick={() => {
                onSelect(group.key)
                controller?.seek(seekTime)
                void controller?.play()
              }}
              aria-label={`Play from ${formatTimestamp(seekTime)}`}
              title="Play the recording from the start of this segment"
              className="inline-flex items-center gap-1.5 rounded-md bg-ink px-2 py-0.5 font-mono text-xs text-paper hover:bg-accent pointer-coarse:min-h-11 pointer-coarse:px-3"
            >
              <Play className="size-3 fill-current" aria-hidden />
              {formatTimestamp(seekTime)}
            </button>
          ) : (
            <span className="rounded-md bg-paper-2 px-2 py-0.5 font-mono text-xs text-ink-2" title="Timestamp of the transcript segment">
              {formatTimestamp(seekTime)}
            </span>
          )
        ) : (
          <span className="font-mono text-xs text-ink-3">no timestamp</span>
        )}
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <span className={`size-2 rounded-full ${severity.dot}`} aria-hidden />
          {severity.label}
        </span>
        {reported && <span className="rounded-full border border-line-strong px-2 text-xs text-ink-2">Reported speech</span>}
        {translated && <span className="rounded-full border border-line-strong px-2 text-xs text-ink-2">From the English translation</span>}
        {!translated && language?.scam_detection_mode === 'translated' && <span className="rounded-full border border-line-strong px-2 text-xs text-ink-2">{spoken} keyword rule</span>}
        <span className="font-medium">{categories.join(' · ')}</span>
      </div>

      <blockquote className={`mt-3 border-l-2 pl-4 font-display text-xl italic leading-snug ${reported ? 'border-accent-light' : 'border-amber-light'}`}>“{group.excerpt}”</blockquote>
      {translated && (
        <p className="mt-2 text-sm text-ink-2" data-testid="original-text">
          <span className="font-medium text-ink">Said in {spoken}: </span>
          {original ? <span lang={transcript.language ?? undefined}>{original}</span> : <span className="text-ink-3">The original sentence could not be matched by time. Compare with the transcript.</span>}
        </p>
      )}

      <ul className="mt-3 space-y-2.5 text-ink-2">
        {group.items.map((item) => (
          <li key={item.id}>
            <p>
              {group.items.length > 1 && <span className="font-medium text-ink">{CATEGORY_LABELS[item.category] ?? item.category}: </span>}
              {group.items.length === 1 && <span className="font-medium text-ink">Why: </span>}
              {item.explanation}
            </p>
            <p>
              <span className="font-medium text-ink">What to do: </span>
              {item.suggested_action}
            </p>
          </li>
        ))}
      </ul>

      {caveats.length > 0 && (
        <ul aria-label="Cautions for this finding" className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-ink-3">
          {caveats.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        {located ? (
          <button type="button" onClick={() => onShowInTranscript(group.key)} className="inline-flex items-center gap-1.5 text-accent underline-offset-4 hover:underline pointer-coarse:min-h-11">
            <ArrowDownToLine className="size-4" aria-hidden />
            {translated ? 'Show in translation' : 'Show in transcript'}
          </button>
        ) : (
          <span className="text-ink-3">Not located in the transcript</span>
        )}
        <details>
          <summary className="flex cursor-pointer items-center text-ink-3 underline-offset-4 hover:underline pointer-coarse:min-h-11">How this was found</summary>
          {group.items.map((item) => (
            <p key={item.id} className="mt-2 text-ink-2">
              {item.trigger}
            </p>
          ))}
        </details>
      </div>
    </li>
  )
}

function countLine(intent: IntentAssessment, passages: number): string {
  const direct = intent.indicators.filter((item) => item.context === 'direct').length
  const quoted = intent.indicators.length - direct
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const head = direct > 0 ? `${plural(direct, 'indicator')} found` : 'No direct indicators'
  return `${head}${quoted > 0 ? `${direct > 0 ? ', plus' : ';'} ${quoted} in quoted or recounted speech` : ''}, in ${plural(passages, 'passage')}.`
}

export function IntentSection({ intent, transcript, language, translation, groups, selected, onSelect, onShowInTranscript }: Props) {
  const languageNotice = scamLanguageNotice(language)
  const translationNotice = scamTranslationNotice(language)
  return (
    <section aria-labelledby="intent-heading">
      <p className="font-mono text-sm text-amber">01 · Scam intent · from the transcript</p>
      <h2 id="intent-heading" className="mt-2 font-display text-2xl font-medium sm:text-3xl">
        Findings
      </h2>
      <p className="mt-3 text-ink-2">
        {languageNotice && <span className="font-medium text-ink">{languageNotice.label}. </span>}
        {intent.summary}
      </p>
      {translationNotice && (
        <p role="note" className="mt-2 border-l-2 border-amber-light pl-3 text-sm text-ink-2">
          {translationNotice}
        </p>
      )}
      {intent.error && <p className="mt-2 text-amber">{intent.error}</p>}
      {intent.risk === 'inconclusive' && (
        <p className="mt-2 text-sm text-ink-3">The detector could not settle on a result. Treat this as no answer, and neither as a warning nor as reassurance.</p>
      )}
      {groups.length > 0 && (
        <p className="mt-2 text-sm text-ink-3">
          {countLine(intent, groups.length)} Indicators are linguistic clues, listed strongest first. They do not prove criminal intent.
        </p>
      )}

      {groups.length > 0 ? (
        <ol className="mt-6 divide-y divide-line border-y border-line">
          {groups.map((group) => (
            <Entry
              key={group.key}
              group={group}
              transcript={transcript}
              translation={translation}
              language={language}
              active={selected !== null && group.ids.includes(selected)}
              onSelect={onSelect}
              onShowInTranscript={onShowInTranscript}
            />
          ))}
        </ol>
      ) : (
        intent.risk === 'none_detected' && (
          <p className="mt-6 border-l-2 border-line-strong pl-4 text-ink-2">
            {intent.analyzed_text === 'translation'
              ? 'No suspicious indicators were identified by the available analysis. It checks an English machine translation for common scam wording, plus a short list of Hindi phrases, so a quiet result is not a clearance.'
              : 'No suspicious indicators were identified by the available analysis. It checks only the transcript, for common English scam wording, so a quiet result is not a clearance.'}
          </p>
        )
      )}

      {(intent.method || groups.length > 0) && (
        <details className="mt-4 text-sm">
          <summary className="flex cursor-pointer items-center text-accent underline-offset-4 hover:underline pointer-coarse:min-h-11">How indicators are found, and what they cannot show</summary>
          <p className="mt-2 text-ink-2">{findingSource({ detector: intent.detector, analyzed_text: intent.analyzed_text })}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
            {sharedFindingNotes(intent.detector).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          {intent.score_note && <p className="mt-2 text-ink-2">{intent.score_note}</p>}
          <ModelNote model={intent.method} />
          <Limitations items={intent.limitations} />
        </details>
      )}
    </section>
  )
}

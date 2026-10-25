import { ArrowDownToLine, Play } from 'lucide-react'

import { usePlayback, usePlaybackState } from '../../hooks/usePlayback'
import { CATEGORY_LABELS, formatTimestamp, segmentOf } from '../../lib/highlight'
import { findingSeekTime, type FindingGroup } from '../../lib/playback'
import type { IntentAssessment, IntentRisk, TranscriptResult } from '../../lib/types'
import { Limitations, ModelNote } from '../ModelNote'

const VIEW: Record<IntentRisk, { label: string; dot: string }> = {
  high: { label: 'Strong indicators', dot: 'bg-danger' },
  elevated: { label: 'Notable indicators', dot: 'bg-amber-light' },
  weak_signals: { label: 'Weak signals only', dot: 'bg-accent' },
  none_detected: { label: 'No indicators found', dot: 'bg-line-strong' },
  inconclusive: { label: 'Inconclusive', dot: 'bg-line-strong' },
  unavailable: { label: 'Unavailable', dot: 'bg-danger' },
}

const SEVERITY = {
  high: { label: 'High signal', dot: 'bg-danger' },
  medium: { label: 'Medium signal', dot: 'bg-amber-light' },
  low: { label: 'Low signal', dot: 'bg-line-strong' },
} as const

interface Props {
  intent: IntentAssessment
  transcript: TranscriptResult
  groups: FindingGroup[]
  selected: string | null
  onSelect: (key: string) => void
  onShowInTranscript: (key: string) => void
}

function Entry({ group, transcript, active, onSelect, onShowInTranscript }: { group: FindingGroup; transcript: TranscriptResult; active: boolean } & Pick<Props, 'onSelect' | 'onShowInTranscript'>) {
  const controller = usePlayback()
  const state = usePlaybackState()
  const reported = group.context === 'reported'
  const seekTime = findingSeekTime({ start_seconds: group.start_seconds })
  const canPlay = seekTime !== null && state.status === 'ready'
  const located = segmentOf(group.items[0], transcript.segments) !== undefined
  const severity = SEVERITY[group.severity]
  const categories = [...new Set(group.items.map((item) => CATEGORY_LABELS[item.category] ?? item.category))]

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
              className="inline-flex items-center gap-1.5 rounded-md bg-ink px-2 py-0.5 font-mono text-xs text-paper hover:bg-accent"
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
        <span className="font-medium">{categories.join(' · ')}</span>
      </div>

      <blockquote className={`mt-3 border-l-2 pl-4 font-display text-xl italic leading-snug ${reported ? 'border-accent-light' : 'border-amber-light'}`}>“{group.excerpt}”</blockquote>

      <ul className="mt-3 space-y-2.5 text-ink-2">
        {group.items.map((item) => (
          <li key={item.id}>
            <p>
              {group.items.length > 1 && <span className="font-medium text-ink">{CATEGORY_LABELS[item.category] ?? item.category}: </span>}
              {group.items.length === 1 && <span className="font-medium text-ink">Why: </span>}
              {item.explanation}
              {item.score !== null && (
                <span className="ml-2 font-mono text-xs text-ink-3" title="NLI entailment score for this sentence. Not a probability that this is a scam.">
                  model score {item.score.toFixed(2)}
                </span>
              )}
            </p>
            <p>
              <span className="font-medium text-ink">What to do: </span>
              {item.suggested_action}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        {located ? (
          <button type="button" onClick={() => onShowInTranscript(group.key)} className="inline-flex items-center gap-1.5 text-accent underline-offset-4 hover:underline">
            <ArrowDownToLine className="size-4" aria-hidden />
            Show in transcript
          </button>
        ) : (
          <span className="text-ink-3">Not located in the transcript</span>
        )}
        <details>
          <summary className="cursor-pointer text-ink-3 underline-offset-4 hover:underline">How this was found</summary>
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

export function IntentSection({ intent, transcript, groups, selected, onSelect, onShowInTranscript }: Props) {
  const view = VIEW[intent.risk]
  return (
    <section aria-labelledby="intent-heading">
      <p className="font-mono text-sm text-amber">02 · Scam intent</p>
      <h2 id="intent-heading" className="mt-2 flex items-center gap-3 font-display text-3xl font-medium sm:text-4xl">
        <span className={`size-3 shrink-0 rounded-full ${view.dot}`} aria-hidden />
        {view.label}
      </h2>
      <p className="mt-3 text-ink-2">{intent.summary}</p>
      {intent.error && <p className="mt-2 text-danger">{intent.error}</p>}
      {groups.length > 0 && (
        <p className="mt-2 text-sm text-ink-3">Indicators are clues found in the conversation, listed strongest first. They don’t confirm fraudulent intent.</p>
      )}

      {groups.length > 0 ? (
        <ol className="mt-6 divide-y divide-line border-y border-line">
          {groups.map((group) => (
            <Entry
              key={group.key}
              group={group}
              transcript={transcript}
              active={selected !== null && group.ids.includes(selected)}
              onSelect={onSelect}
              onShowInTranscript={onShowInTranscript}
            />
          ))}
        </ol>
      ) : (
        intent.risk === 'none_detected' && (
          <p className="mt-6 border-l-2 border-line-strong pl-4 text-ink-2">
            Nothing in the transcript matched the scam check. It covers common English phrases, so this is not a clearance.
          </p>
        )
      )}

      {intent.method && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-accent underline-offset-4 hover:underline">How indicators are found</summary>
          {intent.score_note && <p className="mt-2 text-ink-2">{intent.score_note}</p>}
          <ModelNote model={intent.method} />
          <Limitations items={intent.limitations} />
        </details>
      )}
    </section>
  )
}

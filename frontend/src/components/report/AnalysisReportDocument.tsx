import { AlertTriangle, AudioLines, FlaskConical } from 'lucide-react'

import { BASIS_LABEL, basisOf } from '../../lib/actions'
import { findingSource } from '../../lib/evidence'
import { formatBytes, formatDuration } from '../../lib/format'
import { formatTimestamp } from '../../lib/highlight'
import type { AnalysisEntry } from '../../lib/history'
import { languageLine, scamLanguageNotice, scamTranslationNotice, VOICE_LANGUAGE_NOTE } from '../../lib/languages'
import { groupFindings } from '../../lib/playback'
import { detectorName, FAKE_SCORE_NAME, formatFakeScore, VOICE_READING } from '../../lib/score'
import { categoryLabel, threatAlert } from '../../lib/threat'
import type { Recommendation, TranscriptResult } from '../../lib/types'
import { INTENT_VIEW, VOICE_VIEW } from '../../lib/views'
import { ReportDetails } from '../results/ReportDetails'
import { ThreatAlertPanel } from '../results/ThreatAlertPanel'
import { Badge } from '../ui/Badge'
import { ReportFrame, ReportSection, Unavailable } from './ReportFrame'

const STATUS = { complete: 'Complete', partial: 'Partial: part of the analysis could not run', failed: 'Failed: no results could be produced' } as const
const TYPE = {
  upload: { label: 'Real audio analysis of your file or recording', badge: <Badge tone="info" icon={AudioLines}>Real analysis</Badge> },
  lab: {
    label: 'Real analysis of a Scenario Lab sample (synthetic speech)',
    badge: <Badge tone="info" icon={FlaskConical}>Real analysis · Lab sample</Badge>,
  },
} as const

/**
 * The forensic report for one real analysis, laid out as a document. Every value is read from the backend's response
 * as it was returned; anything the backend did not send is shown as unavailable rather than filled in.
 */
export function AnalysisReportDocument({ entry }: { entry: AnalysisEntry }) {
  const { report } = entry
  const { audio, intent, voice, transcript } = report
  const alert = threatAlert(report)
  const groups = groupFindings(intent.indicators)
  const languageNotice = scamLanguageNotice(report.language)
  const translationNotice = scamTranslationNotice(report.language)
  const intentView = INTENT_VIEW[intent.risk]
  const voiceView = VOICE_VIEW[voice.verdict]
  const plan = report.recommendations

  return (
    <ReportFrame
      id={entry.id}
      completedAt={entry.completedAt}
      typeBadge={TYPE[entry.source].badge}
      typeLabel={TYPE[entry.source].label}
      title={entry.title}
      back={entry.source === 'lab' ? { to: '/lab', label: 'Scenario Lab' } : { to: '/analyze', label: 'Analyze audio' }}
      facts={[
        ['Status', STATUS[report.status]],
        ['Recording', `${audio.filename} · ${audio.format.toUpperCase()} · ${formatDuration(audio.duration_seconds)} · ${formatBytes(audio.size_bytes)}`],
        ['Language', languageLine(report.language)],
      ]}
    >
      {report.status !== 'complete' && (
        <div role="alert" className="flex items-start gap-3 rounded-card border border-amber-light/50 bg-amber-tint/40 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden />
          <div>
            <p className="font-medium text-amber">{report.status === 'failed' ? 'The analysis could not be completed.' : 'Part of the analysis could not run.'}</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-ink-2">
              {report.errors.map((error) => (
                <li key={`${error.component}-${error.code}`}>
                  {error.component}: {error.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {alert && <ThreatAlertPanel alert={alert} />}

      <div className="grid gap-5 md:grid-cols-2">
        <section aria-labelledby="r-intent" className="rounded-card border border-line bg-card p-5 shadow-card">
          <p className="font-mono text-xs text-ink-3">Scam intent · from the transcript</p>
          <h2 id="r-intent" className="mt-2 flex items-center gap-2 text-xl font-semibold text-ink">
            <span className={`size-2.5 rounded-full ${languageNotice ? 'bg-line-strong' : intentView.dot}`} aria-hidden />
            {languageNotice ? languageNotice.label : intentView.label}
          </h2>
          <p className="mt-2 text-sm text-ink-2">{languageNotice ? languageNotice.text : intent.summary}</p>
          {translationNotice && <p className="mt-2 text-sm text-ink-3">{translationNotice}</p>}
          {intent.score_note && <p className="mt-2 text-xs text-ink-3">{intent.score_note}</p>}
          <p className="mt-3 border-t border-line pt-3 text-xs text-ink-3">{findingSource(intent)}</p>
        </section>
        <section aria-labelledby="r-voice" className="rounded-card border border-line bg-card p-5 shadow-card">
          <p className="font-mono text-xs text-ink-3">Voice authenticity · from the audio</p>
          <h2 id="r-voice" className="mt-2 flex items-center gap-2 text-xl font-semibold text-ink">
            <span className={`size-2.5 rounded-full ${voiceView.dot}`} aria-hidden />
            {voiceView.label}
          </h2>
          <p className="mt-2 text-sm text-ink-2">{voice.summary}</p>
          <p className="mt-2 text-sm text-ink-2">{VOICE_READING[voice.verdict]}</p>
          {voice.fake_score_median !== null && voice.windows_analyzed > 0 && (
            <p className="mt-2 font-mono text-xs text-ink-3">
              median {FAKE_SCORE_NAME} {formatFakeScore(voice.fake_score_median)} (not a probability) · {voice.windows_favoring_fake} of {voice.windows_analyzed} windows lean “fake”
            </p>
          )}
          {(voice.detectors ?? []).length > 1 && (
            <ul className="mt-2 space-y-0.5 text-sm text-ink-2">
              {voice.detectors!.map((d) => (
                <li key={d.model.name}>
                  <span className="font-medium text-ink">{detectorName(d.model.name)}:</span> {VOICE_VIEW[d.verdict].label}
                  {d.fake_score_median !== null && <span className="font-mono text-xs text-ink-3"> · median {formatFakeScore(d.fake_score_median)}</span>}
                </li>
              ))}
            </ul>
          )}
          {voice.reliability_caution && <p className="mt-2 text-sm text-ink-3">{voice.reliability_caution}</p>}
          {voice.error && <p className="mt-2 text-sm text-amber">{voice.error}</p>}
          {report.language?.code && report.language.code !== 'en' && <p className="mt-2 text-xs text-ink-3">{VOICE_LANGUAGE_NOTE}</p>}
          <p className="mt-3 border-t border-line pt-3 text-xs text-ink-3">
            A generic fake-versus-real classifier, not a liveness detector. A “fake” lean does not prove a deepfake, and it is not part of the scam-intent result.
          </p>
        </section>
      </div>

      <ReportSection id="r-evidence" kicker="01 · Evidence" title="Quoted passages">
        {intent.risk === 'unavailable' || report.status === 'failed' ? (
          <Unavailable>Scam-intent analysis did not run, so there is no evidence to show. This is not a finding that the call is safe.</Unavailable>
        ) : groups.length === 0 ? (
          <Unavailable>The detector quoted no passages from this transcript. That does not make the call safe.</Unavailable>
        ) : (
          <ol className="space-y-4">
            {groups.map((group) => (
              <li key={group.key} className="rounded-card border border-line bg-card p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <span className="font-mono">{group.start_seconds !== null ? `${formatTimestamp(group.start_seconds)}${group.end_seconds !== null ? `–${formatTimestamp(group.end_seconds)}` : ''}` : 'No timestamp reported'}</span>
                  <Badge tone={group.severity === 'high' ? 'warning' : 'neutral'}>{group.severity} severity</Badge>
                  {group.context === 'reported' && <Badge>Quoted or recounted speech, not counted</Badge>}
                </div>
                <p className="mt-2 border-l-2 border-amber-light pl-3 italic text-ink">“{group.excerpt}”</p>
                {group.items[0]?.original_text && <p className="mt-1 pl-3 text-sm text-ink-3">Original speech: {group.items[0].original_text}</p>}
                <ul className="mt-3 space-y-2 text-sm">
                  {group.items.map((item) => (
                    <li key={item.id || `${item.rule_id}-${item.char_start}`}>
                      <span className="font-medium text-ink">{categoryLabel(item.category)}</span>
                      <span className="text-ink-2"> — {item.explanation}</span>
                      {item.score !== null && <span className="ml-1 font-mono text-xs text-ink-3">(detector score {item.score.toFixed(2)}, not calibrated)</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </ReportSection>

      <ReportSection id="r-transcript" kicker="02 · Transcript" title="What was said">
        <TranscriptBlock transcript={transcript} />
        {report.translation && (
          <div className="mt-6">
            <h3 className="font-semibold text-ink">English machine translation</h3>
            <p className="mt-1 text-sm text-ink-3">Used only for scam detection. It is not what was said, and it has not been checked for accuracy.</p>
            <div className="mt-3">
              <TranscriptBlock transcript={report.translation} />
            </div>
          </div>
        )}
      </ReportSection>

      <ReportSection id="r-actions" kicker="03 · Recommendations" title="What to do next">
        {report.status === 'failed' ? (
          <Unavailable>No recommendations, because the analysis did not complete.</Unavailable>
        ) : (
          <>
            <p className="text-lg text-ink">{plan.headline}</p>
            {plan.detail && <p className="mt-1 text-sm text-ink-3">{plan.detail}</p>}
            {[...plan.items, ...(plan.general ?? [])].length > 0 && (
              <ol className="mt-4 space-y-3">
                {[...plan.items, ...(plan.general ?? [])].map((item) => (
                  <RecommendationItem key={item.id} item={item} />
                ))}
              </ol>
            )}
          </>
        )}
      </ReportSection>

      <ReportDetails report={report} open />

      <p className="text-sm text-ink-3">
        {report.notice} The server deleted its temporary copy of the audio after the analysis. This report exists only in this browser tab’s memory and is not stored anywhere else.
      </p>
    </ReportFrame>
  )
}

function TranscriptBlock({ transcript }: { transcript: TranscriptResult }) {
  if (transcript.status === 'unavailable') return <Unavailable>Speech-to-text did not run{transcript.error ? `: ${transcript.error}` : '.'}</Unavailable>
  if (transcript.status === 'no_speech') return <Unavailable>No speech was detected in this recording.</Unavailable>
  if (transcript.segments.length === 0) return <p className="text-ink">{transcript.text}</p>
  return (
    <>
      <ol className="divide-y divide-line rounded-card border border-line bg-card">
        {transcript.segments.map((segment) => (
          <li key={segment.index} className="flex gap-3 px-4 py-3">
            <span className="w-24 shrink-0 font-mono text-xs text-ink-3">
              {formatTimestamp(segment.start_seconds)}–{formatTimestamp(segment.end_seconds)}
            </span>
            <p className="min-w-0 flex-1 text-ink">{segment.text}</p>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-ink-3">Timestamps are per segment, as reported by speech-to-text. They are not word-level timings.</p>
      {transcript.quality_notes.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-ink-3">
          {transcript.quality_notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </>
  )
}

function RecommendationItem({ item }: { item: Recommendation }) {
  return (
    <li className="rounded-card border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-ink">{item.title}</p>
        <Badge tone={item.priority === 'high' ? 'warning' : 'neutral'}>{item.priority} priority</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-2">{item.detail}</p>
      {item.why && <p className="mt-1 text-sm text-ink-3">{item.why}</p>}
      {item.evidence.length > 0 && (
        <p className="mt-2 text-xs text-ink-3">
          Based on:{' '}
          {item.evidence.map((ref) => `${ref.source === 'voice' ? 'voice result' : `“${ref.label}”`}${ref.start_seconds !== null ? ` at ${formatTimestamp(ref.start_seconds)}` : ''}`).join('; ')}
        </p>
      )}
      <p className="mt-1 text-xs text-ink-3">{BASIS_LABEL[basisOf(item)]}.</p>
    </li>
  )
}

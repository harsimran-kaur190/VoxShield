import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

import { formatBytes, formatDuration } from '../../lib/format'
import { languageLine, languageName } from '../../lib/languages'
import { AUDIO_BAND_LABEL, detectorName, fakeCutoffPercent } from '../../lib/score'
import type { AnalysisReport, ModelInfo } from '../../lib/types'
import { VOICE_VIEW } from '../../lib/views'

const STATUS = { complete: 'Every part ran', partial: 'Part of the analysis could not run', failed: 'The analysis could not be completed' } as const
const TRANSCRIPT = { ok: 'Available', no_speech: 'No speech was detected', unavailable: 'Unavailable' } as const
const STAGE_ORDER = ['decode', 'transcription', 'voice', 'translation', 'intent', 'model_load', 'total'] as const

const modelText = (model: ModelInfo | null | undefined) => (model ? `${model.name}${model.revision ? ` @ ${model.revision.slice(0, 8)}` : ''}` : null)

function Group({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <div>
      <h3 className="font-mono text-sm text-ink-3">{title}</h3>
      <dl className="mt-2 space-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[8.5rem_1fr] gap-3">
            <dt className="text-ink-3">{label}</dt>
            <dd className="min-w-0 break-words text-ink-2">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * Everything the backend reported about how this report was produced, and nothing else. A value the backend did not
 * send is left out or shown as "not reported"; nothing here is estimated, and nothing describes accuracy.
 */
export function ReportDetails({ report, open = false }: { report: AnalysisReport; open?: boolean }) {
  const { audio, transcript, voice, intent, errors } = report
  const timings = STAGE_ORDER.filter((key) => typeof report.timings_seconds[key] === 'number')
  const direct = intent.indicators.filter((item) => item.context === 'direct').length
  const quoted = intent.indicators.length - direct
  const limits = [...new Set([...voice.limitations, ...intent.limitations])]

  const audioRows: [string, ReactNode][] = [
    ['Duration', formatDuration(audio.duration_seconds)],
    ['Format', audio.format.toUpperCase()],
    ['Size', formatBytes(audio.size_bytes)],
  ]
  if (audio.sample_rate_hz) audioRows.push(['Sample rate', `${audio.sample_rate_hz} Hz`])
  if (audio.channels) audioRows.push(['Channels', String(audio.channels)])

  const transcriptRows: [string, ReactNode][] = [['Transcript', TRANSCRIPT[transcript.status]]]
  if (transcript.status === 'ok') transcriptRows.push(['Segments', String(transcript.segments.length)])
  if (transcript.language) transcriptRows.push(['Language', `${transcript.language}${transcript.language_probability !== null ? ` (${Math.round(transcript.language_probability * 100)}% detection score)` : ''}`])
  transcriptRows.push(['Warnings', transcript.quality_notes.length > 0 ? transcript.quality_notes.join(' ') : 'None reported'])
  if (transcript.error) transcriptRows.push(['Error', transcript.error])
  if (modelText(transcript.model)) transcriptRows.push(['Model', <code key="m" className="font-mono text-xs">{modelText(transcript.model)}</code>])

  const lang = report.language
  const languageRows: [string, ReactNode][] = []
  if (lang) {
    languageRows.push(['Asked for', languageName(lang.requested) ?? lang.requested])
    languageRows.push(['Transcribed as', languageLine(lang)])
    if (lang.detected_code) languageRows.push(['Audio sounded like', `${lang.detected_name ?? lang.detected_code}${lang.detected_score !== null ? ` (language-detection score ${Math.round(lang.detected_score * 100)}%)` : ''}${lang.mismatch ? ': does not match your selection' : ''}`])
    const translated = lang.scam_detection_mode === 'translated'
    languageRows.push([
      'Scam detection',
      translated
        ? 'Runs on an English machine translation of the audio, plus Hindi keyword rules on the transcript. Not validated.'
        : lang.scam_detection_supported === true
          ? 'Available for this language'
          : lang.scam_detection_supported === false
            ? (lang.scam_detection_note ?? 'Not validated for this language')
            : 'Language not reported',
    ])
    languageRows.push([
      'Translation',
      translated
        ? report.translation?.status === 'ok'
          ? 'English machine translation, used only for scam detection. The transcript is still in the language that was spoken.'
          : (report.translation?.error ?? 'No translation could be made.')
        : 'None. The transcript is in the language that was spoken.',
    ])
    if (translated && lang.translation_note) languageRows.push(['Translation accuracy', lang.translation_note])
    if (lang.transcription_note) languageRows.push(['Transcription', lang.transcription_note])
    languageRows.push(['Voice check', lang.voice_note])
  }

  const voiceRows: [string, ReactNode][] = [['Result', VOICE_VIEW[voice.verdict].label], ['Windows analyzed', String(voice.windows_analyzed)]]
  if (voice.audio_band) voiceRows.push(['Audio quality', AUDIO_BAND_LABEL[voice.audio_band]])
  if (voice.fake_cutoff != null) voiceRows.push(['“Fake” cut-off', `${fakeCutoffPercent(voice.fake_cutoff)} window score`])
  for (const d of voice.detectors ?? []) voiceRows.push([detectorName(d.model.name), `${VOICE_VIEW[d.verdict].label}${d.error ? ` (${d.error})` : ''}`])
  if (voice.error) voiceRows.push(['Error', voice.error])
  if (modelText(voice.model)) voiceRows.push(['Model', <code key="m" className="font-mono text-xs">{modelText(voice.model)}</code>])

  const intentRows: [string, ReactNode][] = [
    ['Detector', intent.detector === 'nli' ? 'Language model, sentence by sentence' : 'Fixed text rules'],
    ['Indicators', `${direct} direct${quoted > 0 ? `, ${quoted} in quoted or recounted speech` : ''}`],
  ]
  if (intent.suppressed_mentions > 0) intentRows.push(['Held back', `${intent.suppressed_mentions} possible match(es) in protective advice`])
  if ((intent.offer_mentions ?? 0) > 0) intentRows.push(['Offers', `${intent.offer_mentions} sentence(s) offering or asking about sending money`])
  if (intent.uncertain_mentions > 0) intentRows.push(['Unclear', `${intent.uncertain_mentions} sentence(s) the detector could not classify`])
  if (intent.error) intentRows.push(['Error', intent.error])
  if (intent.analyzed_text === 'translation') intentRows.push(['Text checked', 'English machine translation, plus Hindi keyword rules on the original transcript'])
  if (modelText(intent.method)) intentRows.push(['Model', <code key="m" className="font-mono text-xs">{modelText(intent.method)}</code>])

  const statusRows: [string, ReactNode][] = [['Status', STATUS[report.status]]]
  for (const error of errors) statusRows.push([error.component, error.message])
  statusRows.push(['Time (seconds)', timings.length > 0 ? timings.map((key) => `${key.replace('_', ' ')} ${report.timings_seconds[key].toFixed(1)}`).join(' · ') : 'Not reported'])

  return (
    <details open={open} className="group border-t border-line pt-6">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 font-display text-2xl font-medium">
        Report details
        <ChevronDown className="size-5 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <p className="mt-2 max-w-2xl text-sm text-ink-3">What the analysis reported about this recording. These are facts about how the report was made, not measures of accuracy.</p>
      <div className="mt-5 grid gap-8 md:grid-cols-2">
        <Group title="Recording" rows={audioRows} />
        <Group title="Processing" rows={statusRows} />
        <Group title="Transcript (speech-to-text)" rows={transcriptRows} />
        {languageRows.length > 0 && <Group title="Language" rows={languageRows} />}
        <Group title="Voice authenticity (audio)" rows={voiceRows} />
        <Group title="Scam intent (transcript)" rows={intentRows} />
        {limits.length > 0 && (
          <div>
            <h3 className="font-mono text-sm text-ink-3">Limits to keep in mind</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {limits.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}

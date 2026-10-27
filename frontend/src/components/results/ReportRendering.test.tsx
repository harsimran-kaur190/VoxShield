import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { AnalysisReport, IntentIndicator, TranscriptSegment, VoiceAssessment } from '../../lib/types'
import { groupFindings } from '../../lib/playback'
import { IntentSection } from './IntentSection'
import { ReportDetails } from './ReportDetails'
import { ResultsView } from './ResultsView'
import { VoiceSection } from './VoiceSection'

const noop = () => {}
const segments: TranscriptSegment[] = [
  { index: 0, start_seconds: 0, end_seconds: 4, text: 'Hello, this is your bank.', char_start: 0, char_end: 25 },
  { index: 1, start_seconds: 4.5, end_seconds: 9, text: 'Read me the code we just sent you.', char_start: 26, char_end: 60 },
]
const indicator = (over: Partial<IntentIndicator> = {}): IntentIndicator => ({
  id: 'a', rule_id: 'nli_credential_request', category: 'credential_request', severity: 'high', segment_index: 1, char_start: 26, char_end: 60,
  start_seconds: 4.5, end_seconds: 9, excerpt: 'Read me the code we just sent you.', sentence: 'Read me the code we just sent you.', context: 'direct',
  detector: 'nli', score: 0.97, trigger: 't', explanation: 'The model judged that this sentence asks for a code.', suggested_action: 'Do not share it.', ...over,
})
const voiceOf = (verdict: VoiceAssessment['verdict'], median: number | null, windows: number[] = []): VoiceAssessment => ({
  verdict, summary: `Backend summary for ${verdict}.`, fake_score_median: median, fake_score_max: windows.length ? Math.max(...windows) : null,
  windows_analyzed: windows.length, windows_favoring_fake: windows.filter((w) => w >= 0.5).length,
  windows: windows.map((fake_score, i) => ({ start_seconds: i * 6, end_seconds: i * 6 + 6, fake_score })),
  score_note: 'n', decision_rule: 'rule', reliability_caution: null, limitations: ['Voice limit one.'], model: { name: 'voice/model', revision: 'f7050b586236', method: 'm' }, error: null,
})
const reportOf = (over: Partial<AnalysisReport> = {}): AnalysisReport => ({
  status: 'complete',
  audio: { filename: 'call.wav', format: 'wav', size_bytes: 350000, duration_seconds: 9, sample_rate_hz: 16000, channels: 1 },
  transcript: { status: 'ok', text: 'Hello, this is your bank. Read me the code we just sent you.', language: 'en', language_probability: 0.99, segments, quality_notes: [], model: { name: 'faster-whisper/small', revision: null, method: 'm' }, error: null },
  voice: voiceOf('model_favors_real', 0.07, [0.05, 0.09]),
  intent: {
    risk: 'elevated', summary: 'At least one notable indicator was found in the conversation.', indicators: [indicator()], categories: ['credential_request'], suppressed_mentions: 0,
    reported_mentions: 0, uncertain_mentions: 0, detector: 'nli', score_note: null, limitations: ['Intent limit one.'], method: { name: 'intent/model', revision: '8e7e5af5983a', method: 'm' }, error: null,
  },
  recommendations: { state: 'actions', headline: 'h', detail: null, items: [{ id: 'credentials', title: "Don't share codes, PINs or passwords", detail: 'd', priority: 'high', secondary: false, why: 'Organizations do not ask for codes.', basis: 'finding', evidence: [{ source: 'intent', id: 'a', label: 'Read me the code we just sent you.', start_seconds: 4.5 }] }], general: [] },
  errors: [], privacy: { audio_stored: false, transcript_stored: false }, timings_seconds: { decode: 0.1, transcription: 2.1, voice: 2.6, intent: 0.6, model_load: 0, total: 5.4 }, notice: 'x', ...over,
})
const results = (r: AnalysisReport) => renderToStaticMarkup(<MemoryRouter><ResultsView report={r} onReset={noop} onRetry={noop} /></MemoryRouter>)
const voiceHtml = (v: VoiceAssessment) => renderToStaticMarkup(<VoiceSection voice={v} />)
const intentHtml = (r: AnalysisReport) => renderToStaticMarkup(<IntentSection intent={r.intent} transcript={r.transcript} groups={groupFindings(r.intent.indicators)} selected={null} onSelect={noop} onShowInTranscript={noop} />)
const between = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to))

describe('voice report: scores', () => {
  it('a high score is a percentage labelled as the model’s fake-label score, never as a chance of a deepfake', () => {
    const html = voiceHtml(voiceOf('model_favors_fake', 0.82, [0.8, 0.82, 0.9]))
    expect(html).toContain('82%')
    expect(html).toContain('median fake-label score, not a probability')
    expect(html).toContain('not the chance that the voice is fake')
    expect(html).toContain('leans toward the “fake” label')
    expect(html).not.toMatch(/82% (chance|probab|likel)|chance of a deepfake|probability (that )?the voice/i)
    expect(html).not.toMatch(/\b0\.\d\d\b/) // no raw 0-to-1 numbers are left on the page
  })

  it('a low score is shown the same way and leans real', () => {
    const html = voiceHtml(voiceOf('model_favors_real', 0.07, [0.05, 0.09]))
    expect(html).toContain('7%')
    expect(html).toContain('leans toward the “real” label')
    expect(html).toContain('not confirmation that the voice is genuine')
  })

  it('an inconclusive result says no lean was found, and still shows the scores it has', () => {
    const html = voiceHtml(voiceOf('inconclusive', 0.52, [0.3, 0.7]))
    expect(html).toContain('Backend summary for inconclusive.')
    expect(html).toContain('does not lean either way')
    expect(html).toContain('52%')
    expect(between(results(reportOf({ voice: voiceOf('inconclusive', 0.52, [0.3, 0.7]) })), 'id="overview-heading"', 'id="next-heading"')).toContain('Inconclusive')
  })

  it('shows the 0% to 100% scale with every window, its timestamp, and the window counts', () => {
    const html = voiceHtml(voiceOf('model_favors_fake', 0.82, [0.7, 0.82, 0.9]))
    expect(html).toContain('0% · “real” label')
    expect(html).toContain('“fake” label · 100%')
    expect(html).toContain('Scale from 0% to 100%')
    for (const stamp of ['0:00–0:06', '0:06–0:12', '0:12–0:18']) expect(html).toContain(stamp)
    for (const pct of ['70%', '82%', '90%']) expect(html).toContain(pct)
    expect(html).toContain('3 windows analyzed · 3 at or above 50%')
  })

  it('never shows 0% or 100% for what the rounding cannot support', () => {
    const html = voiceHtml(voiceOf('model_favors_fake', 0.998, [0.998, 0.002]))
    expect(html).toContain('&gt;99%')
    expect(html).toContain('&lt;1%')
    const withoutScaleLabels = html.replace(/Scale from 0% to 100%|“fake” label · 100%|0% · “real” label/g, '')
    expect(withoutScaleLabels).not.toMatch(/(?<![\d.])(100|0)%/)  // a rounded score is never shown as 0% or 100%
  })

  it('missing scores: no score is invented, and the page says so', () => {
    const html = voiceHtml(voiceOf('inconclusive', null, []))
    expect(html).toContain('No window scores were returned')
    expect(html).not.toMatch(/NaN|undefined|\b0%/)
    expect(html).not.toContain('Windows analyzed')
  })

  it('unavailable analysis is shown as unavailable, with no score, scale, or scoring explanation', () => {
    const html = voiceHtml({ ...voiceOf('unavailable', null, []), error: 'The voice model could not be loaded.' })
    expect(html).toContain('Voice analysis')
    expect(html).toContain('The voice check could not run')
    expect(between(results(reportOf({ voice: { ...voiceOf('unavailable', null, []), error: 'x' } })), 'id="overview-heading"', 'id="next-heading"')).toContain('Unavailable')
    expect(html).toContain('The voice model could not be loaded.')
    expect(html).not.toMatch(/%|Scale from|How this score is produced/)
  })

  it('says it comes from the audio and cannot explain why the score is what it is', () => {
    const html = voiceHtml(voiceOf('model_favors_fake', 0.82, [0.82]))
    expect(html).toContain('from the audio')
    expect(html).toContain('does not say which sounds or features led to it')
  })
})

describe('scam-intent report', () => {
  it('counts several indicators, shows each with its name, severity, timestamp, quote, reason and action, and does not claim proof', () => {
    const second = indicator({ id: 'b', rule_id: 'nli_urgency', category: 'urgency', severity: 'low', char_start: 0, char_end: 25, start_seconds: 0, end_seconds: 4, segment_index: 0, excerpt: 'Hello, this is your bank.', sentence: 'Hello, this is your bank.', explanation: 'Pressure to act.', suggested_action: 'Slow down.' })
    const html = intentHtml(reportOf({ intent: { ...reportOf().intent, indicators: [indicator(), second] } }))
    expect(html).toContain('2 indicators found, in 2 passages')
    expect(html).toContain('They do not prove criminal intent')
    for (const text of ['Asks for a code or secret', 'Time pressure', 'High signal', 'Low signal', '0:04', '0:00', 'Read me the code we just sent you.', 'Hello, this is your bank.', 'The model judged that this sentence asks for a code.', 'Do not share it.', 'Slow down.']) expect(html).toContain(text)
    expect(html).toContain('from the transcript')
  })

  it('counts quoted speech separately from direct indicators', () => {
    const quoted = indicator({ id: 'q', context: 'reported', severity: 'low', char_start: 0, char_end: 25, segment_index: 0 })
    const html = intentHtml(reportOf({ intent: { ...reportOf().intent, indicators: [indicator(), quoted] } }))
    expect(html).toContain('1 indicator found, plus 1 in quoted or recounted speech')
  })

  it('no indicators: a neutral state that is not a clearance, with no count and no alarm', () => {
    const r = reportOf({ intent: { ...reportOf().intent, risk: 'none_detected', summary: 'No scam indicators were found in the transcript.', indicators: [], categories: [] } })
    const html = intentHtml(r)
    expect(html).toContain('Findings')
    expect(html).toContain('No scam indicators were found in the transcript.')
    expect(html).toContain('No suspicious indicators were identified by the available analysis')
    expect(html).toContain('not a clearance')
    expect(html).not.toMatch(/indicators? found,|They do not prove/)
  })
})

describe('the two assessments stay separate', () => {
  it('a synthetic-leaning voice with no scam indicators is not described as a scam, and gets no fraud score', () => {
    const r = reportOf({ voice: voiceOf('model_favors_fake', 0.9, [0.9]), intent: { ...reportOf().intent, risk: 'none_detected', indicators: [], categories: [], summary: 'No scam indicators were found in the transcript.' }, recommendations: { state: 'actions', headline: 'The voice model leaned “fake”, but no direct scam request was found in the conversation.', detail: null, general: [], items: [{ id: 'voice', title: "Don't rely on the voice to confirm who it is", detail: 'd', priority: 'medium', secondary: false, basis: 'voice', why: 'Voice models can be wrong.', evidence: [{ source: 'voice', id: null, label: 'Model favored “fake”', start_seconds: null }] }] } })
    const html = results(r)
    const overview = between(html, 'id="overview-heading"', 'id="next-heading"')
    expect(overview).toContain('No indicators found')
    expect(overview).toContain('Model favors “fake”')
    expect(html).toContain('From the voice model only. This is not a scam finding')
    expect(html).not.toMatch(/fraud (score|probability|risk)|overall (risk|score)|combined (risk|score|probability)/i)
  })

  it('a natural-sounding voice with strong scam indicators is not described as legitimate', () => {
    const r = reportOf({ voice: voiceOf('model_favors_real', 0.04, [0.04]), intent: { ...reportOf().intent, risk: 'high', summary: 'Several indicators appear together.' } })
    const html = results(r)
    const overview = between(html, 'id="overview-heading"', 'id="next-heading"')
    expect(overview).toContain('Strong indicators')
    expect(overview).toContain('Model favors “real”')
    expect(html).not.toMatch(/\blegitimate\b(?! (organizations|requests))|\bsafe\b/i)
  })

  it('keeps transcript-based and voice-model findings apart and labelled', () => {
    const html = results(reportOf())
    expect(html).toContain('01 · Scam intent · from the transcript')
    expect(html).toContain('02 · Voice authenticity · from the audio')
    expect(html).toContain('Scam-intent analysis (language model) of the speech-to-text transcript. The voice analysis was not used.')
  })

  it('shows no single combined number: the scam-intent side carries no percentage at all, so it cannot be mixed with the voice score', () => {
    const r = reportOf({ voice: voiceOf('model_favors_fake', 0.82, [0.82]) })
    const text = (html: string) => html.replace(/<[^>]+>/g, ' ')
    expect(text(intentHtml(r))).not.toMatch(/\d\s?%/)
    const overview = text(between(results(r), 'id="overview-heading"', 'id="next-heading"'))
    const [scamPanel, voicePanel] = [overview.slice(overview.indexOf('Scam intent'), overview.indexOf('Voice authenticity')), overview.slice(overview.indexOf('Voice authenticity'))]
    expect(scamPanel).not.toMatch(/\d\s?%/)
    expect(voicePanel).toMatch(/fake-label score 82% \(not a probability\)/)
  })
})

describe('transcript evidence', () => {
  it('puts a transcription warning above the transcript and says why it matters', () => {
    const r = reportOf({ transcript: { ...reportOf().transcript, quality_notes: ['The transcription model had low confidence. Words may be wrong.'] } })
    const html = results(r)
    expect(html).toContain('Transcription warning')
    expect(html.indexOf('Transcription warning')).toBeLessThan(html.indexOf('aria-label="Transcript text"'))
    expect(html).toContain('a misheard word can change what is flagged')
  })

  it('no warning block when the backend reported none', () => {
    expect(results(reportOf())).not.toContain('Transcription warning')
  })

  it('an unavailable transcript gives an honest fallback, not an empty box', () => {
    const r = reportOf({ status: 'partial', transcript: { status: 'unavailable', text: '', language: null, language_probability: null, segments: [], quality_notes: [], model: null, error: 'The audio could not be transcribed.' }, intent: { ...reportOf().intent, risk: 'unavailable', indicators: [], categories: [], error: 'Scam intent needs a transcript.' } })
    const html = results(r)
    expect(html).toContain('The audio could not be transcribed.')
    expect(html).not.toContain('aria-label="Transcript text"')
  })

  it('missing timestamps leave the text readable and offer no seeking', () => {
    const noTimes = segments.map((s) => ({ ...s, start_seconds: Number.NaN, end_seconds: Number.NaN }))
    const html = results(reportOf({ transcript: { ...reportOf().transcript, segments: noTimes } }))
    expect(html).toContain('This transcript has no timestamps')
    expect(html).toContain('Hello, this is your bank.')
    expect(html).not.toContain('aria-label="Play from')
  })
})

describe('report details', () => {
  const details = (r: AnalysisReport) => renderToStaticMarkup(<ReportDetails report={r} />)

  it('lists what the backend reported: duration, windows, availability, models, status and timings', () => {
    const html = details(reportOf())
    for (const text of ['9.0s', 'WAV', '16000 Hz', 'Available', 'Segments', 'None reported', 'voice/model @ f7050b58', 'intent/model @ 8e7e5af5', 'faster-whisper/small', 'Every part ran', 'total 5.4', 'Voice limit one.', 'Intent limit one.', 'Language model, sentence by sentence']) expect(html).toContain(text)
    expect(html).toMatch(/Windows analyzed<\/dt><dd[^>]*>2</)
  })

  it('invents nothing when data is missing: no timings, no sample rate, no models', () => {
    const r = reportOf({ timings_seconds: {}, audio: { ...reportOf().audio, sample_rate_hz: null, channels: null }, voice: { ...voiceOf('inconclusive', null, []), model: null, limitations: [] }, intent: { ...reportOf().intent, method: null, limitations: [] }, transcript: { ...reportOf().transcript, model: null } })
    const html = details(r)
    expect(html).toContain('Not reported')
    expect(html).not.toMatch(/Sample rate|Channels|Model<|Limits to keep in mind|NaN|undefined/)
  })

  it('shows component errors and an unavailable transcript or voice check as such', () => {
    const r = reportOf({ status: 'partial', errors: [{ component: 'voice', code: 'x', message: 'The voice model could not be loaded.' }], voice: { ...voiceOf('unavailable', null, []), error: 'The voice model could not be loaded.' }, transcript: { ...reportOf().transcript, status: 'no_speech', segments: [], text: '' } })
    const html = details(r)
    expect(html).toContain('Part of the analysis could not run')
    expect(html).toContain('The voice model could not be loaded.')
    expect(html).toContain('Unavailable')
    expect(html).toContain('No speech was detected')
  })

  it('makes no claim about accuracy, deletion, or storage', () => {
    const html = details(reportOf())
    expect(html).toContain('not measures of accuracy')
    expect(html.replace('not measures of accuracy', '')).not.toMatch(/accura|confidence interval|calibrated to|deleted|stored|never/i)
  })

  it('is part of the report, below the steps and collapsed', () => {
    const html = results(reportOf())
    expect(html).toContain('Report details')
    expect(html.indexOf('Report details')).toBeGreaterThan(html.indexOf('id="steps-heading"'))
    expect(html).toMatch(/<details class="group border-t border-line pt-6"><summary[^>]*>Report details/)
  })
})

describe('compact report structure', () => {
  const visibleText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim()
  const words = (html: string) => visibleText(html).split(' ').filter(Boolean).length

  it('puts the two assessments, the next step, then the evidence first, and the player and transcript after', () => {
    const html = results(reportOf())
    const order = ['id="overview-heading"', 'id="next-heading"', 'id="intent-heading"', 'id="voice-heading"', 'Recording timeline', 'id="transcript-heading"', 'id="steps-heading"', 'Report details'].map((m) => [m, html.indexOf(m)] as const)
    for (const [marker, at] of order) expect(at, marker).toBeGreaterThan(-1)
    expect(order.map(([, at]) => at)).toEqual([...order.map(([, at]) => at)].sort((a, b) => a - b))
  })

  it('keeps the score, its label, the bar, the reading and the window count visible, and puts the rest in an expander', () => {
    const v = { ...voiceOf('model_favors_fake', 0.82, [0.7, 0.82, 0.9]), reliability_caution: 'Informal spot check, not an evaluation.', decision_rule: 'Majority of windows.' }
    const html = voiceHtml(v)
    const at = html.indexOf('<details')
    const [shown, hidden] = [html.slice(0, at), html.slice(at)]
    for (const text of ['82%', 'median fake-label score, not a probability', '3 windows analyzed · 3 at or above 50%', 'Scale from 0% to 100%', 'Voice analysis', 'leans toward the “fake” label']) expect(shown, text).toContain(text)
    for (const text of ['0:00–0:06', '0:06–0:12', 'Informal spot check, not an evaluation.', 'Majority of windows.', 'Voice limit one.', 'voice/model @ f7050b58', 'nothing more specific']) {
      expect(visibleText(shown), text).not.toContain(text)
      expect(visibleText(hidden), text).toContain(text)
    }
    expect(visibleText(hidden)).toMatch(/not calibrated and not the chance that the voice is fake/)
  })

  it('moves the exploratory spot-check sentence into the expander, still on the page', () => {
    const v = { ...voiceOf('model_favors_fake', 0.82, [0.82]), summary: "The model's 'fake' label won in 1 of 1 windows. On phone-quality audio it did the same for a few real voices in VoxShield's benchmark." }
    const html = voiceHtml(v)
    const at = html.indexOf('<details')
    expect(visibleText(html.slice(0, at))).toContain("The model's 'fake' label won in 1 of 1 windows.")
    expect(visibleText(html.slice(0, at))).not.toMatch(/benchmark/)
    expect(visibleText(html.slice(at))).toContain("On phone-quality audio it did the same for a few real voices in VoxShield's benchmark.")
  })

  it('keeps the voice panel short on screen: well under a paragraph of reading before the expander', () => {
    const html = voiceHtml(voiceOf('model_favors_fake', 0.82, [0.82]))
    expect(words(html.slice(0, html.indexOf('<details')))).toBeLessThan(110)
  })

  it('the expander is a real disclosure that works without a pointer: a summary element inside details', () => {
    expect(voiceHtml(voiceOf('model_favors_fake', 0.82, [0.82]))).toMatch(/<details[^>]*><summary[^>]*>Window scores and how the score is produced<\/summary>/)
  })

  it('shows each finding as timestamp, severity, name, quote, one reason and the action, with the trigger and score in its own expander', () => {
    const r = reportOf({ intent: { ...reportOf().intent, indicators: [indicator({ trigger: 'TRIGGER-TEXT: model score 0.97 for a statement.' })] } })
    const html = intentHtml(r)
    const entry = html.slice(html.indexOf('data-finding-ids'), html.indexOf('How indicators are found'))
    const shown = entry.slice(0, entry.indexOf('<details'))
    for (const text of ['0:04', 'High signal', 'Asks for a code or secret', 'Read me the code we just sent you.', 'The model judged that this sentence asks for a code.', 'Do not share it.', 'Show in transcript']) expect(shown, text).toContain(text)
    expect(shown).not.toContain('TRIGGER-TEXT')
    expect(entry.slice(entry.indexOf('<details'))).toContain('TRIGGER-TEXT')
    expect(shown).not.toMatch(/model score|not the chance|Findings depend|Source:/i)
  })

  it('says where findings come from once, in one expander, and keeps nothing out of reach', () => {
    const html = intentHtml(reportOf())
    const at = html.indexOf('How indicators are found, and what they cannot show')
    expect(at).toBeGreaterThan(-1)
    const hidden = html.slice(at)
    for (const text of ['Scam-intent analysis (language model) of the speech-to-text transcript', 'The voice analysis was not used.', 'not the chance that a scam occurred', 'Findings depend on the transcript being correct.', 'Intent limit one.', 'intent/model @ 8e7e5af5']) expect(visibleText(hidden), text).toContain(text)
  })

  it('never shows a green safe state, and a clean result is a neutral grey', () => {
    const clean = reportOf({ voice: voiceOf('model_favors_real', 0.04, [0.04]), intent: { ...reportOf().intent, risk: 'none_detected', indicators: [], categories: [], summary: 'No scam indicators were found in the transcript.' }, recommendations: { state: 'none_detected', headline: 'No suspicious indicators were detected in the analyzed transcript.', detail: null, items: [], general: [] } })
    const html = results(clean)
    expect(html).not.toMatch(/bg-(green|emerald|ok|success)|text-(green|emerald|ok|success)|\bsafe\b/i)
    expect(between(html, 'id="overview-heading"', 'id="next-heading"')).toContain('bg-line-strong')
  })
})


import type { AnalysisReport, LanguageInfo, TranscriptSegment } from '../lib/types'

const VOICE_NOTE = "The voice check was tested by VoxShield only on read speech and computer voices, not on real calls. It caught neural voices far more often in English than in Hindi, so a 'real' lean outside English is weak evidence."
const TRANSCRIPTION_NOTE = 'Hindi is transcribed by the same small multilingual speech-to-text model used for English. VoxShield has not measured its accuracy in Hindi.'

export const language = (over: Partial<LanguageInfo> = {}): LanguageInfo => ({
  requested: 'auto', code: 'en', name: 'English', source: 'detected', detection_score: 0.97, detected_code: null, detected_name: null, detected_score: null,
  mismatch: false, scam_detection_supported: true, scam_detection_note: null, scam_detection_mode: 'direct', translation_note: null, transcription_note: null, voice_note: VOICE_NOTE, ...over,
})

export const HINDI_TEXT = 'मुझे अपना कोड बताइए।'
export const PUNJABI_TEXT = 'ਮੈਨੂੰ ਆਪਣਾ ਕੋਡ ਦੱਸੋ।'
const PUNJABI_NOTE = "Scam detection is not validated for Punjabi. VoxShield's scam-intent detectors were built and checked on English text, and only Hindi and Urdu are checked through a translation, so no scam result is shown for this recording."

/** An English report with one scam finding, as the backend returns it. Tests change only what they are about. */
export function englishReport(over: Partial<AnalysisReport> = {}): AnalysisReport {
  const text = 'Hello, this is your bank. Read me the code we just sent you.'
  const segments: TranscriptSegment[] = [{ index: 0, start_seconds: 0, end_seconds: 6, text, char_start: 0, char_end: text.length }]
  return {
    status: 'complete',
    audio: { filename: 'call.wav', format: 'wav', size_bytes: 350000, duration_seconds: 6, sample_rate_hz: 16000, channels: 1 },
    transcript: { status: 'ok', text, language: 'en', language_probability: 0.97, language_source: 'detected', segments, quality_notes: [], model: null, error: null },
    voice: {
      verdict: 'model_favors_real', summary: "The model's 'real' label won in 1 of 1 windows.", fake_score_median: 0.07, fake_score_max: 0.07, windows_analyzed: 1, windows_favoring_fake: 0,
      windows: [{ start_seconds: 0, end_seconds: 6, fake_score: 0.07 }], score_note: 'n', decision_rule: null, reliability_caution: null, limitations: [], model: null, error: null,
    },
    intent: {
      risk: 'elevated', summary: 'At least one notable indicator was found in the conversation.', categories: ['credential_request'], suppressed_mentions: 0, reported_mentions: 0, uncertain_mentions: 0,
      detector: 'nli', score_note: null, limitations: [], method: null, error: null,
      indicators: [{
        id: 'a', rule_id: 'nli_credential_request', category: 'credential_request', severity: 'high', segment_index: 0, char_start: 26, char_end: text.length, start_seconds: 0, end_seconds: 6,
        excerpt: 'Read me the code we just sent you.', sentence: 'Read me the code we just sent you.', context: 'direct', detector: 'nli', score: 0.97, trigger: 't', explanation: 'The model judged that this sentence asks for a code.', suggested_action: 'Do not share it.',
      }],
    },
    recommendations: { state: 'actions', headline: 'h', detail: null, general: [], items: [{ id: 'credentials', title: "Don't share codes, PINs or passwords", detail: 'd', priority: 'high', secondary: false, why: 'w', basis: 'finding', evidence: [{ source: 'intent', id: 'a', label: 'Read me the code we just sent you.', start_seconds: 0 }] }] },
    errors: [], language: language(), privacy: { audio_stored: false, transcript_stored: false }, timings_seconds: { total: 3 }, notice: 'x', ...over,
  }
}

const SPANISH_TEXT = 'Hola, le llamo de su banco. Por favor, dígame el código que le enviamos.'
const TRANSLATION_NOTE = 'Scam detection for this language runs on a machine translation into English, made by the same speech-to-text model from the audio, plus Hindi keyword rules on the original transcript. VoxShield has not measured how accurate this is.'

/** A report for speech in a language with no scam-detection path (Spanish), shaped as the backend returns it. */
export function unsupportedLanguageReport(source: 'selected' | 'detected' = 'detected', over: Partial<AnalysisReport> = {}): AnalysisReport {
  const base = englishReport()
  const note = "Scam detection is not validated for Spanish. VoxShield's scam-intent detectors were built and checked on English text, and only Hindi and Urdu are checked through a translation, so no scam result is shown for this recording."
  return englishReport({
    transcript: {
      ...base.transcript, text: SPANISH_TEXT, language: 'es', language_source: source, language_probability: source === 'detected' ? 0.91 : null,
      segments: [{ index: 0, start_seconds: 0, end_seconds: 4, text: SPANISH_TEXT, char_start: 0, char_end: SPANISH_TEXT.length }],
    },
    intent: { ...base.intent, risk: 'inconclusive', summary: note, indicators: [], categories: [] },
    recommendations: { state: 'insufficient', headline: "There isn't enough reliable evidence to recommend a result-specific action.", detail: note, items: [], general: [] },
    language: language({ requested: 'auto', code: 'es', name: 'Spanish', source, detection_score: source === 'detected' ? 0.91 : null, scam_detection_supported: false, scam_detection_note: note, scam_detection_mode: 'not_run' }),
    ...over,
  })
}

/** Punjabi speech found by auto-detection. Punjabi is not supported: the transcript is shown, but no scam check runs. */
export function detectedPunjabiReport(): AnalysisReport {
  const base = englishReport()
  return englishReport({
    transcript: {
      ...base.transcript, text: PUNJABI_TEXT, language: 'pa', language_source: 'detected', language_probability: 0.93,
      segments: [{ index: 0, start_seconds: 0, end_seconds: 4, text: PUNJABI_TEXT, char_start: 0, char_end: PUNJABI_TEXT.length }],
    },
    intent: { ...base.intent, risk: 'inconclusive', summary: PUNJABI_NOTE, indicators: [], categories: [] },
    recommendations: { state: 'insufficient', headline: "There isn't enough reliable evidence to recommend a result-specific action.", detail: PUNJABI_NOTE, items: [], general: [] },
    language: language({ code: 'pa', name: 'Punjabi', detection_score: 0.93, scam_detection_supported: false, scam_detection_note: PUNJABI_NOTE, scam_detection_mode: 'not_run' }),
  })
}

/**
 * A Hindi report checked through an English translation, shaped as the backend returns it: one finding from
 * the translation (pointing into the translation text, with the original sentence attached) and one from the keyword
 * rules (pointing into the original transcript).
 */
export function translatedReport(code: 'hi' = 'hi', source: 'selected' | 'detected' = 'selected', over: Partial<AnalysisReport> = {}): AnalysisReport {
  const name = 'Hindi'
  const original = HINDI_TEXT
  const keyword = 'कोड बताइए'
  const english = 'Please tell me your one time password.'
  const base = englishReport()
  const lead = `Checked through an English machine translation of the ${name} speech, which VoxShield has not validated.`
  const at = original.indexOf(keyword)
  return englishReport({
    transcript: {
      ...base.transcript, text: original, language: code, language_source: source, language_probability: source === 'detected' ? 0.91 : null,
      segments: [{ index: 0, start_seconds: 0, end_seconds: 4, text: original, char_start: 0, char_end: original.length }],
    },
    translation: {
      status: 'ok', text: english, language: 'en', language_probability: null, language_source: 'translated',
      segments: [{ index: 0, start_seconds: 0, end_seconds: 4, text: english, char_start: 0, char_end: english.length }],
      quality_notes: ['Machine translation to English. It can drop, add, or change words, so check it against the original.'],
      model: { name: 'faster-whisper/small', revision: null, method: `Whisper speech translation from ${name} to English (task=translate), from the audio` }, error: null,
    },
    intent: {
      ...base.intent, risk: 'elevated', summary: `${lead} At least one notable indicator was found in the conversation.`, analyzed_text: 'translation',
      indicators: [
        {
          id: 'tr-a', rule_id: 'nli_credential_request', category: 'credential_request', severity: 'high', segment_index: 0, char_start: 0, char_end: english.length, start_seconds: 0, end_seconds: 4,
          excerpt: english, sentence: english, context: 'direct', detector: 'nli', score: 0.95, trigger: 't', explanation: 'The model judged that this sentence asks for a code.', suggested_action: 'Do not share it.',
          text_source: 'translation', original_text: original, original_segment_index: 0,
        },
        {
          id: `indic_cred_request-${at}`, rule_id: 'indic_cred_request', category: 'credential_request', severity: 'high', segment_index: 0, char_start: at, char_end: at + keyword.length, start_seconds: 0, end_seconds: 4,
          excerpt: keyword, sentence: original, context: 'direct', detector: 'rules', score: null, trigger: 'Hindi keyword rule', explanation: 'The speaker asks for a code (Hindi wording).', suggested_action: 'Do not share it.',
          text_source: 'transcript',
        },
      ],
    },
    language: language({
      requested: source === 'selected' ? code : 'auto', code, name, source, detection_score: source === 'detected' ? 0.91 : null,
      scam_detection_supported: true, scam_detection_mode: 'translated', translation_note: TRANSLATION_NOTE, transcription_note: TRANSCRIPTION_NOTE,
    }),
    timings_seconds: { total: 4, translation: 1.4 },
    ...over,
  })
}

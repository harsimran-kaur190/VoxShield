export interface AudioMetadata {
  filename: string
  format: string
  size_bytes: number
  duration_seconds: number
  sample_rate_hz: number | null
  channels: number | null
}

export interface ModelInfo {
  name: string
  revision: string | null
  method: string
}

export interface ComponentError {
  component: 'audio' | 'transcription' | 'voice' | 'intent'
  code: string
  message: string
}

export interface TranscriptSegment {
  index: number
  start_seconds: number
  end_seconds: number
  text: string
  char_start: number
  char_end: number
  avg_logprob?: number | null
  no_speech_prob?: number | null
}

export interface TranscriptResult {
  status: 'ok' | 'no_speech' | 'unavailable'
  text: string
  language: string | null
  /** The language-detection score, present only when the language was detected (never for a language you selected). */
  language_probability: number | null
  /** 'translated': this is the speech-to-text model's English translation of the audio, not what was said. */
  language_source?: 'detected' | 'selected' | 'translated' | null
  detected_language?: string | null
  detected_language_score?: number | null
  language_mismatch?: boolean
  segments: TranscriptSegment[]
  quality_notes: string[]
  model: ModelInfo | null
  error: string | null
}

/** What language was asked for and used, and what is and is not known about it. Absent in reports from older servers. */
export interface LanguageInfo {
  requested: 'auto' | 'en' | 'hi'
  code: string | null
  name: string | null
  source: 'detected' | 'selected' | 'unknown'
  detection_score: number | null
  detected_code: string | null
  detected_name: string | null
  detected_score: number | null
  mismatch: boolean
  scam_detection_supported: boolean | null
  scam_detection_note: string | null
  /** 'direct': the detectors read the transcript. 'translated': they read an English translation. Absent in older reports. */
  scam_detection_mode?: ScamDetectionMode | null
  translation_note?: string | null
  transcription_note: string | null
  voice_note: string
}

export type ScamDetectionMode = 'direct' | 'translated' | 'not_run'

export type VoiceVerdict = 'model_favors_fake' | 'model_favors_real' | 'inconclusive' | 'unavailable'

export interface VoiceWindow {
  start_seconds: number
  end_seconds: number
  fake_score: number
}

/** One detector's own reading, present when more than one detector ran. Absent in older reports. */
export interface VoiceDetectorResult {
  model: ModelInfo
  verdict: VoiceVerdict
  fake_score_median: number | null
  windows_analyzed: number
  windows_favoring_fake: number
  error: string | null
}

export interface VoiceAssessment {
  verdict: VoiceVerdict
  summary: string
  fake_score_median: number | null
  fake_score_max: number | null
  windows_analyzed: number
  windows_favoring_fake: number
  windows: VoiceWindow[]
  score_note: string
  decision_rule: string | null
  reliability_caution: string | null
  limitations: string[]
  model: ModelInfo | null
  error: string | null
  /** Every detector that ran. Empty or absent when one detector produced the result. */
  detectors?: VoiceDetectorResult[]
  /** "narrowband": phone or VoIP quality. Absent in older reports. */
  audio_band?: 'full_band' | 'narrowband' | 'unknown' | null
  /** The window score from which the result counts as leaning "fake". Absent in older reports, which used 0.5. */
  fake_cutoff?: number | null
}

export type IntentRisk = 'none_detected' | 'weak_signals' | 'elevated' | 'high' | 'inconclusive' | 'unavailable'

export interface IntentIndicator {
  id: string
  rule_id: string
  category: string
  severity: 'low' | 'medium' | 'high'
  segment_index: number | null
  char_start: number
  char_end: number
  start_seconds: number | null
  end_seconds: number | null
  excerpt: string
  sentence: string
  context: 'direct' | 'reported'
  detector: 'rules' | 'nli'
  score: number | null
  /** Which text the offsets point into. Absent means the transcript, as in older reports. */
  text_source?: 'transcript' | 'translation'
  /** For a finding in the translation: the original-language transcript text spoken at the same time. */
  original_text?: string | null
  original_segment_index?: number | null
  trigger: string
  explanation: string
  suggested_action: string
}

export interface IntentAssessment {
  risk: IntentRisk
  summary: string
  indicators: IntentIndicator[]
  categories: string[]
  suppressed_mentions: number
  /** Sentences where the speaker offered, or asked about, sending money. Not counted as requests. Absent in older reports. */
  offer_mentions?: number
  reported_mentions: number
  uncertain_mentions: number
  detector: 'rules' | 'nli'
  /** 'translation': the detector read an English translation of non-English speech. Absent in older reports. */
  analyzed_text?: 'transcript' | 'translation'
  score_note: string | null
  limitations: string[]
  method: ModelInfo | null
  error: string | null
}

export type Priority = 'high' | 'medium' | 'low'

export interface EvidenceRef {
  source: 'intent' | 'voice'
  id: string | null
  label: string
  start_seconds: number | null
}

export interface Recommendation {
  id: string
  title: string
  detail: string
  priority: Priority
  evidence: EvidenceRef[]
  secondary: boolean
  /** One short sentence on why this matters. Absent in reports from older servers. */
  why?: string | null
  /** What the advice follows from. Absent means a finding, as before. */
  basis?: RecommendationBasis
}

export type RecommendationBasis = 'finding' | 'voice' | 'general'

export interface RecommendationPlan {
  state: 'actions' | 'none_detected' | 'reported_only' | 'insufficient'
  headline: string
  detail: string | null
  items: Recommendation[]
  /** Ordinary precautions offered when no direct request was found. */
  general?: Recommendation[]
}

export interface AnalysisReport {
  status: 'complete' | 'partial' | 'failed'
  audio: AudioMetadata
  transcript: TranscriptResult
  voice: VoiceAssessment
  intent: IntentAssessment
  recommendations: RecommendationPlan
  errors: ComponentError[]
  language?: LanguageInfo | null
  /** The English translation used for scam detection on Hindi or Urdu speech. Never replaces the transcript. */
  translation?: TranscriptResult | null
  privacy: { audio_stored: boolean; transcript_stored: boolean }
  timings_seconds: Record<string, number>
  notice: string
}

export type Stage = 'decode' | 'transcription' | 'voice' | 'intent'
export type StageState = 'pending' | 'running' | 'done' | 'failed'

export interface ModelStatus {
  role: string
  name: string
  revision: string | null
  license: string
  loaded: boolean
  details: string
}

export interface ModelsResponse {
  models: ModelStatus[]
  voice_spot_check: string
  own_evaluation_performed: boolean
}

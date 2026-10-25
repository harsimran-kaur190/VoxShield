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
}

export interface TranscriptResult {
  status: 'ok' | 'no_speech' | 'unavailable'
  text: string
  language: string | null
  language_probability: number | null
  segments: TranscriptSegment[]
  quality_notes: string[]
  model: ModelInfo | null
  error: string | null
}

export type VoiceVerdict = 'model_favors_fake' | 'model_favors_real' | 'inconclusive' | 'unavailable'

export interface VoiceWindow {
  start_seconds: number
  end_seconds: number
  fake_score: number
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
  reported_mentions: number
  uncertain_mentions: number
  detector: 'rules' | 'nli'
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
}

export interface RecommendationPlan {
  state: 'actions' | 'none_detected' | 'reported_only' | 'insufficient'
  headline: string
  detail: string | null
  items: Recommendation[]
}

export interface AnalysisReport {
  status: 'complete' | 'partial' | 'failed'
  audio: AudioMetadata
  transcript: TranscriptResult
  voice: VoiceAssessment
  intent: IntentAssessment
  recommendations: RecommendationPlan
  errors: ComponentError[]
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

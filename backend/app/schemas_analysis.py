from typing import Literal

from pydantic import BaseModel, Field

from app.schemas import AudioMetadata

NOTICE = "The voice and scam-intent assessments are independent and are never combined into one score."


class ModelInfo(BaseModel):
    name: str
    revision: str | None = None
    method: str


class ComponentError(BaseModel):
    component: Literal["audio", "transcription", "voice", "intent"]
    code: str
    message: str


class TranscriptSegment(BaseModel):
    index: int
    start_seconds: float
    end_seconds: float
    text: str
    char_start: int
    char_end: int
    avg_logprob: float | None = None
    no_speech_prob: float | None = None


class TranscriptResult(BaseModel):
    status: Literal["ok", "no_speech", "unavailable"]
    text: str = ""
    language: str | None = None
    # Only set when the language was detected. A language the user selected has no detection score, and none is made up.
    language_probability: float | None = None
    # "translated": this is Whisper's English translation of the audio, not what was said.
    language_source: Literal["detected", "selected", "translated"] | None = None
    # In manual mode the model's own guess about the audio, used only to warn when it disagrees with the selection.
    detected_language: str | None = None
    detected_language_score: float | None = None
    language_mismatch: bool = False
    segments: list[TranscriptSegment] = []
    quality_notes: list[str] = []
    model: ModelInfo | None = None
    error: str | None = None


class LanguageInfo(BaseModel):
    """What language was asked for, what was used, and what is and is not known about it. The transcript stays in the
    spoken language; a translation, when one was used for scam detection, is reported separately."""

    requested: Literal["auto", "en", "hi"]
    code: str | None = None  # language of the transcript; None when it could not be determined
    name: str | None = None
    source: Literal["detected", "selected", "unknown"] = "unknown"
    detection_score: float | None = None  # only for source == "detected"
    detected_code: str | None = None  # manual mode: what the audio sounded like
    detected_name: str | None = None
    detected_score: float | None = None
    mismatch: bool = False
    scam_detection_supported: bool | None = None  # None: the language is unknown
    scam_detection_note: str | None = None
    # "direct": the English detectors read the transcript. "translated": they read an English translation of the audio.
    # "not_run": no scam result was made (see scam_detection_note). None: no transcript to decide from.
    scam_detection_mode: Literal["direct", "translated", "not_run"] | None = None
    translation_note: str | None = None
    transcription_note: str | None = None
    voice_note: str


class VoiceWindow(BaseModel):
    start_seconds: float
    end_seconds: float
    fake_score: float = Field(ge=0, le=1)


VoiceVerdict = Literal["model_favors_fake", "model_favors_real", "inconclusive", "unavailable"]


class VoiceDetectorResult(BaseModel):
    """One detector's own reading, so a combined result always shows which model leaned which way."""

    model: ModelInfo
    verdict: VoiceVerdict
    fake_score_median: float | None = None
    windows_analyzed: int = 0
    windows_favoring_fake: int = 0
    error: str | None = None


class VoiceAssessment(BaseModel):
    verdict: VoiceVerdict
    summary: str
    fake_score_median: float | None = None
    fake_score_max: float | None = None
    windows_analyzed: int = 0
    windows_favoring_fake: int = 0
    windows: list[VoiceWindow] = []
    score_note: str = (
        "Each score is a two-way softmax of the model's raw logits for its 'fake' label. It is a normalized score, "
        "not a calibrated probability, and not a probability of fraud."
    )
    decision_rule: str | None = None
    reliability_caution: str | None = None
    limitations: list[str] = []
    model: ModelInfo | None = None
    error: str | None = None
    # Every detector that ran, in order. Empty when a single detector produced the result.
    detectors: list[VoiceDetectorResult] = []
    # "narrowband": phone or VoIP quality, nothing above about 3.4-4 kHz. "unknown": too short to measure.
    audio_band: Literal["full_band", "narrowband", "unknown"] | None = None
    # The window score from which the result counts as leaning "fake". 0.5 unless the audio is full band.
    fake_cutoff: float | None = None


IntentRisk = Literal["none_detected", "weak_signals", "elevated", "high", "inconclusive", "unavailable"]
Severity = Literal["low", "medium", "high"]


class IntentIndicator(BaseModel):
    id: str = ""
    rule_id: str
    category: str
    severity: Severity
    segment_index: int | None
    char_start: int
    char_end: int
    start_seconds: float | None = None
    end_seconds: float | None = None
    excerpt: str
    sentence: str = ""
    context: Literal["direct", "reported"] = "direct"
    detector: Literal["rules", "nli"] = "rules"
    score: float | None = None  # NLI entailment score for model findings; None for rule findings
    # Which text the character offsets and segment_index point into: the original transcript, or the English translation.
    text_source: Literal["transcript", "translation"] = "transcript"
    # For a finding in the translation: the original-language transcript text spoken at the same time, as evidence.
    original_text: str | None = None
    original_segment_index: int | None = None
    trigger: str = ""
    explanation: str
    suggested_action: str


class IntentAssessment(BaseModel):
    risk: IntentRisk
    summary: str
    indicators: list[IntentIndicator] = []
    categories: list[str] = []
    suppressed_mentions: int = 0
    offer_mentions: int = 0  # sentences where the speaker offered or asked about sending money; not counted as requests
    reported_mentions: int = 0
    uncertain_mentions: int = 0
    detector: Literal["rules", "nli"] = "rules"
    # "translation": the detector read an English translation of non-English speech (see AnalysisReport.translation).
    analyzed_text: Literal["transcript", "translation"] = "transcript"
    score_note: str | None = None
    limitations: list[str] = []
    method: ModelInfo | None = None
    error: str | None = None


Priority = Literal["high", "medium", "low"]


class EvidenceRef(BaseModel):
    """Points at the finding that triggered a recommendation."""

    source: Literal["intent", "voice"]
    id: str | None = None  # matches IntentIndicator.id for source="intent"
    label: str
    start_seconds: float | None = None


class Recommendation(BaseModel):
    id: str
    title: str
    detail: str
    priority: Priority
    evidence: list[EvidenceRef] = []
    secondary: bool = False
    # One short sentence on why this matters, written in advance for the action (never generated from the transcript).
    why: str | None = None
    # "finding": follows from a scam-intent finding in this recording. "voice": follows from the voice model's lean and
    # says nothing about scams. "general": an ordinary precaution that does not depend on the analysis result.
    basis: Literal["finding", "voice", "general"] = "finding"


class RecommendationPlan(BaseModel):
    state: Literal["actions", "none_detected", "reported_only", "insufficient"]
    headline: str
    detail: str | None = None
    items: list[Recommendation] = []
    # General precautions shown when the analysis found no direct request but the user may still want a next step.
    general: list[Recommendation] = []


class Privacy(BaseModel):
    audio_stored: bool = False
    transcript_stored: bool = False


class AnalysisReport(BaseModel):
    status: Literal["complete", "partial", "failed"]
    audio: AudioMetadata
    transcript: TranscriptResult
    voice: VoiceAssessment
    intent: IntentAssessment
    recommendations: RecommendationPlan
    errors: list[ComponentError] = []
    language: LanguageInfo | None = None
    # Whisper's English translation of the audio, made only to run scam detection on Hindi or Urdu speech.
    translation: TranscriptResult | None = None
    privacy: Privacy = Privacy()
    timings_seconds: dict[str, float] = {}
    notice: str = NOTICE


class ModelStatus(BaseModel):
    role: str
    name: str
    revision: str | None
    license: str
    loaded: bool
    details: str


class ModelsResponse(BaseModel):
    models: list[ModelStatus]
    voice_spot_check: str
    own_evaluation_performed: bool = False

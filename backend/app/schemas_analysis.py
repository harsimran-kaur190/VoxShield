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
    language_probability: float | None = None
    segments: list[TranscriptSegment] = []
    quality_notes: list[str] = []
    model: ModelInfo | None = None
    error: str | None = None


class VoiceWindow(BaseModel):
    start_seconds: float
    end_seconds: float
    fake_score: float = Field(ge=0, le=1)


VoiceVerdict = Literal["model_favors_fake", "model_favors_real", "inconclusive", "unavailable"]


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
    trigger: str = ""
    explanation: str
    suggested_action: str


class IntentAssessment(BaseModel):
    risk: IntentRisk
    summary: str
    indicators: list[IntentIndicator] = []
    categories: list[str] = []
    suppressed_mentions: int = 0
    reported_mentions: int = 0
    uncertain_mentions: int = 0
    detector: Literal["rules", "nli"] = "rules"
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


class RecommendationPlan(BaseModel):
    state: Literal["actions", "none_detected", "reported_only", "insufficient"]
    headline: str
    detail: str | None = None
    items: list[Recommendation] = []


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

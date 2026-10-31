"""DeepTruth's common response format. Every detection module, whatever the media type, returns a ModuleResult, and the
fusion step combines them into one DeepTruthReport. Keeping the shape fixed is what lets the dashboard and the PDF
report treat an image heatmap, an audio spectrogram and a video timeline the same way."""

from typing import Any, Literal

from pydantic import BaseModel, Field

Modality = Literal["image", "audio", "video_frames", "lipsync", "video_temporal"]
EvidenceType = Literal["heatmap", "timeline", "spectrogram", "metadata"]
Verdict = Literal["Likely manipulated", "No manipulation detected", "Inconclusive", "Mixed signals"]
MediaKind = Literal["image", "audio", "video"]


class Evidence(BaseModel):
    """One piece of supporting evidence. `data` is whatever the renderer for `type` needs (a 2-D array for a
    spectrogram or heatmap, a list of segments for a timeline, key/value pairs for metadata)."""

    type: EvidenceType
    label: str
    data: Any


class ModuleResult(BaseModel):
    modality: Modality
    # 0 = looks authentic, 1 = looks manipulated. A model's normalized output, not a calibrated probability.
    score: float = Field(ge=0, le=1)
    # How much the fusion step should trust this score (0 = ignore it). Heuristic, from media quality and model agreement.
    reliability: float = Field(ge=0, le=1)
    evidence: list[Evidence] = []
    limitations: list[str] = []
    # "unavailable": the module could not run. Its score is then 0.5 with reliability 0, so it never moves the verdict.
    status: Literal["ok", "unavailable"] = "ok"
    # Short human-readable summary and the model(s) behind the score, for the per-module dashboard card.
    summary: str = ""
    models: list[str] = []
    error: str | None = None
    # Plain-language explanation for the dashboard and report: what the module looks at, and how far its accuracy is known.
    checks: str = ""
    basis: Literal["measured", "heuristic"] | None = None
    basis_note: str = ""


class MediaInfo(BaseModel):
    """What the upload turned out to be. Filled by preprocess.detect_type from the file's bytes, never its extension."""

    filename: str
    kind: MediaKind
    format: str  # container or image format, e.g. "wav", "mp4", "jpeg"
    size_bytes: int
    duration_seconds: float | None = None
    width: int | None = None
    height: int | None = None
    has_audio: bool | None = None
    has_video: bool | None = None
    sample_rate_hz: int | None = None
    channels: int | None = None


class DeepTruthReport(BaseModel):
    verdict: Verdict
    # One sentence on how the verdict was reached (which band, how many modules, or which modules conflict).
    verdict_reason: str = ""
    # Modules that pointed firmly in opposite directions (they may still be outvoted by one strong signal).
    disagreement: list[str] | None = None
    # The modality of the module whose strong reading decided the verdict on its own, when that rule applied.
    decided_by: Modality | None = None
    # The headline number: the deciding module's score when one strong signal decided, otherwise the weighted average.
    manipulation_likelihood: float = Field(ge=0, le=1)
    # Reliability-weighted average of every module's score, always reported for comparison.
    weighted_average: float = Field(default=0.5, ge=0, le=1)
    # How far the result can be trusted: the mean reliability of the modules that ran.
    confidence: float = Field(ge=0, le=1)
    modules: list[ModuleResult]
    limitations: list[str]
    media: MediaInfo
    status: Literal["complete", "partial", "failed"]
    timings_seconds: dict[str, float] = {}
    notice: str = (
        "Manipulation likelihood is a normalized model score, not a calibrated probability. A high score is a reason to "
        "verify the media through another channel, not proof of a deepfake."
    )

from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class LanguageChoice(BaseModel):
    code: str
    name: str
    scam_detection_validated: bool | None = None  # None for auto-detect: it depends on the language that is found
    # How scam detection treats this language: read directly ("direct", English) or through a translation ("translated").
    scam_detection: Literal["direct", "translated"] | None = None


class LimitsResponse(BaseModel):
    max_upload_mb: int
    min_duration_seconds: float
    max_duration_seconds: float
    allowed_extensions: list[str]
    languages: list[LanguageChoice] = []


class AudioMetadata(BaseModel):
    filename: str
    format: str
    size_bytes: int
    duration_seconds: float
    sample_rate_hz: int | None
    channels: int | None


class UploadValidationResponse(BaseModel):
    status: str = "validated"
    stored: bool = False
    analysis_performed: bool = False
    message: str
    audio: AudioMetadata


class ErrorBody(BaseModel):
    code: str
    message: str


class CallRoomCreated(BaseModel):
    room_id: str
    max_participants: int
    idle_expiry_seconds: float

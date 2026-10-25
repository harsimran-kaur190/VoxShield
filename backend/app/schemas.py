from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class LimitsResponse(BaseModel):
    max_upload_mb: int
    min_duration_seconds: float
    max_duration_seconds: float
    allowed_extensions: list[str]


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

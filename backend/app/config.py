from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_VOICE_MODEL_ID = "Gustking/wav2vec2-large-xlsr-deepfake-audio-classification"
DEFAULT_VOICE_MODEL_REVISION = "f7050b586236dc910d1157f430def2d0647b02b4"
DEFAULT_SCAM_MODEL_ID = "MoritzLaurer/deberta-v3-base-zeroshot-v2.0"
DEFAULT_SCAM_MODEL_REVISION = "8e7e5af5983a0ddb1a5b45a38b129ab69e2258e8"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VOXSHIELD_", env_file=".env", extra="ignore")

    app_version: str = "0.3.0"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    # Optional pattern for origins that cannot be listed in advance, such as Vercel preview URLs.
    cors_origin_regex: str | None = None
    # Interactive API docs are handy locally and unnecessary on a public server.
    docs_enabled: bool = True
    # Requests allowed per client address per minute on the upload and analysis endpoints. 0 turns the limit off.
    rate_limit_per_minute: int = 20

    max_upload_mb: int = 25
    max_duration_seconds: float = 600
    min_duration_seconds: float = 1

    preload_models: bool = True
    max_concurrent_analyses: int = 4

    whisper_model_size: str = "small"
    whisper_revision: str | None = None
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_language: str | None = None
    whisper_beam_size: int = 5

    voice_model_id: str = DEFAULT_VOICE_MODEL_ID
    voice_model_revision: str | None = DEFAULT_VOICE_MODEL_REVISION
    voice_device: str = "cpu"
    voice_window_seconds: float = 6
    voice_min_window_seconds: float = 2
    voice_min_audio_seconds: float = 4
    voice_max_windows: int = 10
    voice_silence_rms: float = 0.003
    voice_majority_ratio: float = 0.66
    voice_borderline_low: float = 0.4
    voice_borderline_high: float = 0.6

    # Which scam-intent detector produces the findings: the transparent rules, or the zero-shot NLI model.
    scam_detector: Literal["rules", "nli"] = "nli"
    scam_model_id: str = DEFAULT_SCAM_MODEL_ID
    scam_model_revision: str | None = DEFAULT_SCAM_MODEL_REVISION
    scam_model_device: str = "cpu"
    scam_batch_size: int = 16
    scam_max_pair_tokens: int = 192
    scam_max_pairs: int = 5400
    # Entailment-score cut-offs. They are heuristics chosen on a small development set, not calibrated probabilities.
    scam_nli_threshold: float = 0.92
    scam_nli_uncertain_threshold: float = 0.30
    scam_nli_reported_threshold: float = 0.50

    @property
    def effective_scam_revision(self) -> str | None:
        if self.scam_model_id == DEFAULT_SCAM_MODEL_ID:
            return self.scam_model_revision
        return self.scam_model_revision if self.scam_model_revision != DEFAULT_SCAM_MODEL_REVISION else None

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def effective_voice_revision(self) -> str | None:
        if self.voice_model_id == DEFAULT_VOICE_MODEL_ID:
            return self.voice_model_revision
        return self.voice_model_revision if self.voice_model_revision != DEFAULT_VOICE_MODEL_REVISION else None


@lru_cache
def get_settings() -> Settings:
    return Settings()

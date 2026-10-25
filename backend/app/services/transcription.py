import logging
import threading
import time
from collections.abc import Callable
from typing import Any

from app.config import Settings
from app.schemas_analysis import ModelInfo, TranscriptResult, TranscriptSegment
from app.services.interfaces import Audio16k, ComponentFailure

logger = logging.getLogger("voxshield.transcription")

SILENCE_NO_SPEECH_PROB = 0.6
SILENCE_AVG_LOGPROB = -1.0


def _default_factory(settings: Settings) -> Any:
    from faster_whisper import WhisperModel

    return WhisperModel(
        settings.whisper_model_size,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
        revision=settings.whisper_revision,
    )


class FasterWhisperTranscriber:
    def __init__(self, settings: Settings, model_factory: Callable[[Settings], Any] = _default_factory):
        self._settings = settings
        self._factory = model_factory
        self._model: Any = None
        self.load_seconds: float | None = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def ensure_loaded(self) -> Any:
        """Load the model once, even when called from several threads. Records how long the load took."""
        with self._lock:
            if self._model is None:
                started = time.perf_counter()
                try:
                    self._model = self._factory(self._settings)
                    self.load_seconds = round(time.perf_counter() - started, 2)
                except Exception as error:
                    logger.error("Whisper model failed to load: %s", type(error).__name__)
                    raise ComponentFailure(
                        "model_load_failed",
                        f"The speech-to-text model '{self._settings.whisper_model_size}' could not be loaded.",
                    ) from error
            return self._model

    def _model_info(self) -> ModelInfo:
        s = self._settings
        return ModelInfo(
            name=f"faster-whisper/{s.whisper_model_size}",
            revision=s.whisper_revision,
            method=f"Whisper via CTranslate2 ({s.whisper_device}, {s.whisper_compute_type}) with voice-activity filtering",
        )

    def transcribe(self, audio: Audio16k) -> TranscriptResult:
        model = self.ensure_loaded()
        try:
            with self._lock:
                raw_segments, info = model.transcribe(
                    audio,
                    language=self._settings.whisper_language,
                    vad_filter=True,
                    condition_on_previous_text=False,
                    beam_size=self._settings.whisper_beam_size,
                )
                raw = list(raw_segments)
        except Exception as error:
            logger.error("Transcription failed: %s", type(error).__name__)
            raise ComponentFailure("transcription_failed", "The audio could not be transcribed.") from error

        kept = [
            s
            for s in raw
            if s.text.strip() and not (s.no_speech_prob > SILENCE_NO_SPEECH_PROB and s.avg_logprob < SILENCE_AVG_LOGPROB)
        ]
        if not kept:
            return TranscriptResult(
                status="no_speech",
                language=None,
                model=self._model_info(),
                quality_notes=["No speech was detected in this audio."],
            )

        segments: list[TranscriptSegment] = []
        parts: list[str] = []
        cursor = 0
        for index, seg in enumerate(kept):
            text = seg.text.strip()
            start = cursor
            parts.append(text)
            cursor += len(text)
            segments.append(
                TranscriptSegment(
                    index=index,
                    start_seconds=round(float(seg.start), 2),
                    end_seconds=round(float(seg.end), 2),
                    text=text,
                    char_start=start,
                    char_end=cursor,
                    avg_logprob=round(float(seg.avg_logprob), 3),
                    no_speech_prob=round(float(seg.no_speech_prob), 3),
                )
            )
            cursor += 1  # the joining space

        notes: list[str] = []
        mean_logprob = sum(s.avg_logprob or 0 for s in segments) / len(segments)
        if mean_logprob < SILENCE_AVG_LOGPROB:
            notes.append("The transcription model had low confidence. Words may be wrong.")
        if info.language_probability < 0.5:
            notes.append("The spoken language was detected with low confidence.")

        return TranscriptResult(
            status="ok",
            text=" ".join(parts),
            language=info.language,
            language_probability=round(float(info.language_probability), 3),
            segments=segments,
            quality_notes=notes,
            model=self._model_info(),
        )

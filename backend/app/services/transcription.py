import logging
import threading
import time
from collections.abc import Callable
from typing import Any

from app.config import Settings
from app.schemas_analysis import ModelInfo, TranscriptResult, TranscriptSegment
from app.services.interfaces import Audio16k, ComponentFailure
from app.services.languages import MISMATCH_SCORE, language_name

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

    def _guess_language(self, model: Any, audio: Audio16k) -> tuple[str, float] | None:
        """The model's own guess at the language, used only to warn when it disagrees with a language the user selected.
        A failure here never fails the analysis."""
        try:
            with self._lock:
                code, score, _ = model.detect_language(audio)
            return str(code), float(score)
        except Exception as error:
            logger.error("Language check failed: %s", type(error).__name__)
            return None

    def _run(self, model: Any, audio: Audio16k, language: str | None, task: str) -> tuple[list[Any], Any]:
        """One Whisper pass, with silent or hallucinated segments dropped."""
        try:
            with self._lock:
                raw_segments, info = model.transcribe(
                    audio,
                    language=language,
                    task=task,
                    vad_filter=True,
                    condition_on_previous_text=False,
                    beam_size=self._settings.whisper_beam_size,
                )
                raw = list(raw_segments)
        except Exception as error:
            logger.error("Whisper %s failed: %s", task, type(error).__name__)
            if task == "translate":
                raise ComponentFailure("translation_failed", "The speech could not be translated to English.") from error
            raise ComponentFailure("transcription_failed", "The audio could not be transcribed.") from error
        kept = [
            s
            for s in raw
            if s.text.strip() and not (s.no_speech_prob > SILENCE_NO_SPEECH_PROB and s.avg_logprob < SILENCE_AVG_LOGPROB)
        ]
        return kept, info

    @staticmethod
    def _segments(kept: list[Any]) -> tuple[list[TranscriptSegment], list[str]]:
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
        return segments, parts

    def translate(self, audio: Audio16k, language: str) -> TranscriptResult:
        """Whisper's own English translation of the speech, made from the audio (not from the transcript text). Used only
        so the English scam detectors can check Hindi or Urdu speech; it never replaces the transcript."""
        model = self.ensure_loaded()
        kept, _ = self._run(model, audio, language, "translate")
        s = self._settings
        info = ModelInfo(
            name=f"faster-whisper/{s.whisper_model_size}",
            revision=s.whisper_revision,
            method=f"Whisper speech translation from {language_name(language)} to English (task=translate), from the audio",
        )
        if not kept:
            return TranscriptResult(
                status="no_speech", language="en", language_source="translated", model=info,
                quality_notes=["The translation pass found no speech to translate."],
            )
        segments, parts = self._segments(kept)
        notes = ["Machine translation to English. It can drop, add, or change words, so check it against the original."]
        if sum(seg.avg_logprob or 0 for seg in segments) / len(segments) < SILENCE_AVG_LOGPROB:
            notes.append("The translation model had low confidence. The English wording may be wrong.")
        return TranscriptResult(
            status="ok", text=" ".join(parts), language="en", language_source="translated",
            segments=segments, quality_notes=notes, model=info,
        )

    def transcribe(self, audio: Audio16k, language: str | None = None) -> TranscriptResult:
        """Transcribe in the spoken language; nothing is translated. `language` is a Whisper code chosen by the user, or
        None to detect it. A language pinned in the server settings counts as selected too."""
        model = self.ensure_loaded()
        selected = language or self._settings.whisper_language
        kept, info = self._run(model, audio, selected, "transcribe")
        if not kept:
            return TranscriptResult(
                status="no_speech",
                language=selected,
                language_source="selected" if selected else None,
                model=self._model_info(),
                quality_notes=["No speech was detected in this audio."],
            )

        segments, parts = self._segments(kept)
        notes: list[str] = []
        mean_logprob = sum(s.avg_logprob or 0 for s in segments) / len(segments)
        if mean_logprob < SILENCE_AVG_LOGPROB:
            notes.append("The transcription model had low confidence. Words may be wrong.")

        # With a language given, Whisper reports a probability of 1 that is not a measurement, so none is returned.
        # Without one, the probability is the model's own language-detection score.
        detected = None if selected is None else self._guess_language(model, audio)
        mismatch = bool(selected and detected and detected[0] != selected and detected[1] >= MISMATCH_SCORE)
        if selected is None and info.language_probability < 0.5:
            notes.append("The spoken language was detected with low confidence.")
        if mismatch and detected:
            notes.append(
                f"You selected {language_name(selected)}, but the audio sounded like {language_name(detected[0])} "
                f"(language-detection score {round(detected[1] * 100)}%). The transcript may not match what was said."
            )

        return TranscriptResult(
            status="ok",
            text=" ".join(parts),
            language=selected or info.language,
            language_probability=None if selected else round(float(info.language_probability), 3),
            language_source="selected" if selected else "detected",
            detected_language=detected[0] if detected else None,
            detected_language_score=round(detected[1], 3) if detected else None,
            language_mismatch=mismatch,
            segments=segments,
            quality_notes=notes,
            model=self._model_info(),
        )

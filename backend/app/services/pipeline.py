import logging
import time
from collections.abc import Iterator
from typing import Any

from app.config import Settings
from app.schemas import AudioMetadata
from app.schemas_analysis import (
    AnalysisReport,
    ComponentError,
    IntentAssessment,
    ModelInfo,
    TranscriptResult,
    VoiceAssessment,
)
from app.services.audio_io import AudioDecodeError, load_mono_16k
from app.services.interfaces import ComponentFailure, ScamIntentAnalyzer, Transcriber, VoiceAuthenticityClassifier
from app.services.recommendations import build_recommendations

logger = logging.getLogger("voxshield.pipeline")
STAGES = ("decode", "transcription", "voice", "intent")


def _stage(stage: str, state: str) -> dict[str, Any]:
    return {"type": "stage", "stage": stage, "state": state}


class AnalysisPipeline:
    def __init__(
        self,
        settings: Settings,
        transcriber: Transcriber,
        voice: VoiceAuthenticityClassifier,
        intent: ScamIntentAnalyzer,
    ):
        self._settings = settings
        self._transcriber = transcriber
        self._voice = voice
        self._intent = intent

    def run(self, audio_path, metadata: AudioMetadata) -> Iterator[dict[str, Any]]:
        """Yield progress events, then a final {'type': 'report', 'report': AnalysisReport}."""
        errors: list[ComponentError] = []
        timings: dict[str, float] = {}
        request_started = time.perf_counter()

        yield _stage("decode", "running")
        started = time.perf_counter()
        try:
            audio = load_mono_16k(audio_path, max_seconds=self._settings.max_duration_seconds * 1.05 + 1)
        except AudioDecodeError as error:
            yield _stage("decode", "failed")
            errors.append(ComponentError(component="audio", code="decode_failed", message=str(error)))
            yield {"type": "report", "report": self._failed_report(metadata, errors)}
            return
        timings["decode"] = round(time.perf_counter() - started, 2)
        yield _stage("decode", "done")

        yield _stage("transcription", "running")
        started = time.perf_counter()
        loaded_before = self._is_loaded(self._transcriber)
        transcript = self._guard(
            "transcription", errors, lambda: self._transcriber.transcribe(audio), self._transcript_unavailable
        )
        self._record(timings, "transcription", started, self._transcriber, loaded_before)
        yield _stage("transcription", "failed" if transcript.status == "unavailable" else "done")

        yield _stage("voice", "running")
        started = time.perf_counter()
        loaded_before = self._is_loaded(self._voice)
        voice = self._guard("voice", errors, lambda: self._voice.classify(audio), self._voice_unavailable)
        self._record(timings, "voice", started, self._voice, loaded_before)
        yield _stage("voice", "failed" if voice.verdict == "unavailable" else "done")

        yield _stage("intent", "running")
        started = time.perf_counter()
        loaded_before = self._is_loaded(self._intent)
        if transcript.status == "unavailable":
            intent = self._intent_unavailable("Scam intent needs a transcript, and transcription was unavailable.")
        else:
            intent = self._guard(
                "intent", errors, lambda: self._intent.analyze(transcript), self._intent_unavailable
            )
        self._record(timings, "intent", started, self._intent, loaded_before)
        timings["model_load"] = round(timings.get("model_load", 0.0), 2)
        timings["total"] = round(time.perf_counter() - request_started, 2)
        yield _stage("intent", "failed" if intent.risk == "unavailable" else "done")

        unavailable = [
            transcript.status == "unavailable",
            voice.verdict == "unavailable",
            intent.risk == "unavailable",
        ]
        status = "failed" if transcript.status == "unavailable" and voice.verdict == "unavailable" else (
            "partial" if any(unavailable) else "complete"
        )
        report = AnalysisReport(
            status=status,
            audio=metadata,
            transcript=transcript,
            voice=voice,
            intent=intent,
            recommendations=build_recommendations(voice, intent),
            errors=errors,
            timings_seconds=timings,
        )
        yield {"type": "report", "report": report}

    @staticmethod
    def _is_loaded(component: Any) -> bool:
        return bool(getattr(component, "loaded", True))

    @staticmethod
    def _record(timings: dict[str, float], stage: str, started: float, component: Any, loaded_before: bool) -> None:
        """Store stage time with this request's model-load time split out, so warm and cold requests compare fairly."""
        elapsed = time.perf_counter() - started
        load = 0.0
        if not loaded_before and getattr(component, "loaded", False):
            load = float(getattr(component, "load_seconds", None) or 0.0)
        timings["model_load"] = timings.get("model_load", 0.0) + load
        timings[stage] = round(max(elapsed - load, 0.0), 2)

    def _guard(self, component: str, errors: list[ComponentError], action, fallback):
        try:
            return action()
        except ComponentFailure as failure:
            errors.append(ComponentError(component=component, code=failure.code, message=failure.message))
            return fallback(failure.message)
        except Exception as error:
            logger.error("%s failed unexpectedly: %s", component, type(error).__name__)
            message = "This component failed unexpectedly."
            errors.append(ComponentError(component=component, code="unexpected_error", message=message))
            return fallback(message)

    @staticmethod
    def _transcript_unavailable(message: str) -> TranscriptResult:
        return TranscriptResult(status="unavailable", error=message)

    @staticmethod
    def _voice_unavailable(message: str) -> VoiceAssessment:
        return VoiceAssessment(
            verdict="unavailable",
            summary="Voice authenticity could not be assessed. No result is shown rather than a guess.",
            error=message,
        )

    def _intent_unavailable(self, message: str) -> IntentAssessment:
        return IntentAssessment(
            risk="unavailable",
            detector=getattr(self._intent, "detector_name", "rules"),
            summary="Scam intent could not be assessed. No result is shown rather than a guess.",
            error=message,
        )

    def _failed_report(self, metadata: AudioMetadata, errors: list[ComponentError]) -> AnalysisReport:
        voice = self._voice_unavailable(errors[0].message)
        intent = self._intent_unavailable(errors[0].message)
        return AnalysisReport(
            status="failed",
            audio=metadata,
            transcript=self._transcript_unavailable(errors[0].message),
            voice=voice,
            intent=intent,
            recommendations=build_recommendations(voice, intent),
            errors=errors,
        )

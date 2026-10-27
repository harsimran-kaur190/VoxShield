import io
import struct
import wave

import numpy as np

from app.schemas_analysis import IntentAssessment, TranscriptResult, TranscriptSegment, VoiceAssessment
from app.services.interfaces import ComponentFailure


def make_wav(seconds: float = 2.0, rate: int = 16000, amplitude: float = 0.0) -> bytes:
    frames = int(rate * seconds)
    samples = (np.sin(np.linspace(0, 440 * seconds * 6.283, frames)) * amplitude * 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(samples.tobytes() if amplitude else struct.pack("<h", 0) * frames)
    return buffer.getvalue()


def transcript_of(text: str, language: str = "en") -> TranscriptResult:
    return TranscriptResult(
        status="ok",
        text=text,
        language=language,
        language_probability=0.99,
        segments=[TranscriptSegment(index=0, start_seconds=0, end_seconds=5, text=text, char_start=0, char_end=len(text))],
    )


class FakeTranscriber:
    def __init__(
        self,
        result: TranscriptResult | None = None,
        error: Exception | None = None,
        translation: TranscriptResult | None = None,
        translate_error: Exception | None = None,
    ):
        self.result, self.error = result, error
        self.translation, self.translate_error = translation, translate_error
        self.languages_requested: list[str | None] = []  # what the pipeline asked for, one entry per call
        self.translations_requested: list[str | None] = []

    def transcribe(self, audio, language=None):
        self.languages_requested.append(language)
        if self.error:
            raise self.error
        return self.result

    def translate(self, audio, language):
        self.translations_requested.append(language)
        if self.translate_error:
            raise self.translate_error
        if self.translation is None:
            return TranscriptResult(status="no_speech", language="en", language_source="translated")
        return self.translation


def translation_of(text: str, start: float = 0, end: float = 5) -> TranscriptResult:
    """A stand-in for Whisper's English translation of the audio."""
    return TranscriptResult(
        status="ok",
        text=text,
        language="en",
        language_source="translated",
        segments=[TranscriptSegment(index=0, start_seconds=start, end_seconds=end, text=text, char_start=0, char_end=len(text))],
    )


class FakeVoice:
    def __init__(self, result: VoiceAssessment | None = None, error: Exception | None = None):
        self.result, self.error = result, error

    def classify(self, audio):
        if self.error:
            raise self.error
        return self.result


def voice_result(verdict: str = "inconclusive") -> VoiceAssessment:
    return VoiceAssessment(verdict=verdict, summary="stubbed for a test; not a real model result")


FAIL = ComponentFailure("model_load_failed", "The model could not be loaded.")

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
    def __init__(self, result: TranscriptResult | None = None, error: Exception | None = None):
        self.result, self.error = result, error

    def transcribe(self, audio):
        if self.error:
            raise self.error
        return self.result


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

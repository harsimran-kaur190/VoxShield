from typing import Protocol

import numpy as np
from numpy.typing import NDArray

from app.schemas_analysis import IntentAssessment, TranscriptResult, VoiceAssessment

Audio16k = NDArray[np.float32]


class Transcriber(Protocol):
    def transcribe(self, audio: Audio16k, language: str | None = None) -> TranscriptResult: ...


class VoiceAuthenticityClassifier(Protocol):
    def classify(self, audio: Audio16k) -> VoiceAssessment: ...


class ScamIntentAnalyzer(Protocol):
    def analyze(self, transcript: TranscriptResult) -> IntentAssessment: ...


class ComponentFailure(Exception):
    """Raised by a component when it cannot run. The message must be safe to show the user."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

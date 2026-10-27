from dataclasses import dataclass
from functools import lru_cache

from app.config import get_settings
from app.services.pipeline import AnalysisPipeline
from app.services.scam_intent import RuleBasedScamIntentAnalyzer
from app.services.scam_nli import NliModel, NliScamIntentAnalyzer
from app.services.transcription import FasterWhisperTranscriber
from app.services.voice_authenticity import CombinedVoiceClassifier, HfAudioClassifier, build_voice_service


@dataclass
class Services:
    transcriber: FasterWhisperTranscriber
    voice: HfAudioClassifier | CombinedVoiceClassifier
    intent: RuleBasedScamIntentAnalyzer | NliScamIntentAnalyzer
    pipeline: AnalysisPipeline


@lru_cache
def get_services() -> Services:
    settings = get_settings()
    transcriber = FasterWhisperTranscriber(settings)
    voice = build_voice_service(settings)
    intent = NliScamIntentAnalyzer(settings, NliModel(settings)) if settings.scam_detector == "nli" else RuleBasedScamIntentAnalyzer()
    return Services(transcriber, voice, intent, AnalysisPipeline(settings, transcriber, voice, intent))


def get_pipeline() -> AnalysisPipeline:
    return get_services().pipeline

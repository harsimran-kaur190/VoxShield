from fastapi import APIRouter

from app.config import get_settings
from app.dependencies import get_services
from app.schemas_analysis import ModelsResponse, ModelStatus
from app.services.scam_intent import METHOD
from app.services.voice_authenticity import SPOT_CHECK, CombinedVoiceClassifier

router = APIRouter(tags=["models"])


def _scam_status(settings, services) -> ModelStatus:
    if settings.scam_detector == "nli":
        return ModelStatus(
            role="Scam intent",
            name=settings.scam_model_id,
            revision=settings.effective_scam_revision,
            license="MIT (as stated on the model page)",
            loaded=services.intent.loaded,
            details="Zero-shot natural-language-inference classifier (DeBERTa-v3 base) applied sentence by sentence. Loaded from safetensors without remote code. Scores are entailment probabilities, not calibrated scam probabilities.",
        )
    return ModelStatus(
        role="Scam intent",
        name=f"{METHOD.name} v{METHOD.revision}",
        revision=None,
        license="Project code",
        loaded=True,
        details="Transparent English rules with negation handling. Not a machine-learning model.",
    )


def _voice_detectors(services) -> list:
    voice = services.voice
    return voice.detectors if isinstance(voice, CombinedVoiceClassifier) else [voice]


def _secondary_status(settings, services) -> list[ModelStatus]:
    detectors = _voice_detectors(services)
    if len(detectors) < 2:
        return []
    return [
        ModelStatus(
            role="Voice authenticity (second detector)",
            name=settings.voice_secondary_model_id,
            revision=settings.voice_secondary_model_revision,
            license="Apache-2.0 (as stated on the model page)",
            loaded=detectors[1].loaded,
            details="wav2vec2-XLSR classifier fine-tuned on ASVspoof 2019, run on every recording next to the default detector. "
            "On full-band audio the voice result leans 'fake' if either detector does; on phone or VoIP audio it is shown but "
            "does not decide, because over the Opus codec it called 4 of 119 real voices fake in VoxShield's benchmark. "
            "Loaded from safetensors without remote code.",
        )
    ]


def _voice_status(settings, services) -> ModelStatus:
    loaded = _voice_detectors(services)[0].loaded
    if settings.voice_model_id.startswith("nii-yamagishilab/"):
        return ModelStatus(
            role="Voice authenticity",
            name=settings.voice_model_id,
            revision=settings.effective_voice_revision,
            license="CC BY-NC-SA 4.0, non-commercial use only (as stated on the model page)",
            loaded=loaded,
            details="NII AntiDeepfake: MMS-300M wav2vec2 encoder, mean pooling and a linear real/fake layer, trained by its authors on about 74,000 hours of real and synthetic speech in over 100 languages. Loaded from safetensors without remote code.",
        )
    return ModelStatus(
        role="Voice authenticity",
        name=settings.voice_model_id,
        revision=settings.effective_voice_revision,
        license="As stated on the model page",
        loaded=loaded,
        details="wav2vec2 sequence classifier with two labels, real and fake. Loaded from safetensors without remote code.",
    )


@router.get("/models", response_model=ModelsResponse)
def models() -> ModelsResponse:
    settings = get_settings()
    services = get_services()
    return ModelsResponse(
        voice_spot_check=SPOT_CHECK,
        models=[
            ModelStatus(
                role="Speech-to-text",
                name=f"Systran/faster-whisper-{settings.whisper_model_size}",
                revision=settings.whisper_revision,
                license="MIT",
                loaded=services.transcriber.loaded,
                details=f"OpenAI Whisper converted for CTranslate2. Runs on {settings.whisper_device} with {settings.whisper_compute_type} weights.",
            ),
            _voice_status(settings, services),
            *_secondary_status(settings, services),
            _scam_status(settings, services),
        ]
    )

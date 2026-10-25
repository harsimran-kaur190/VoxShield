from fastapi import APIRouter

from app.config import get_settings
from app.dependencies import get_services
from app.schemas_analysis import ModelsResponse, ModelStatus
from app.services.scam_intent import METHOD
from app.services.voice_authenticity import SPOT_CHECK

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
            ModelStatus(
                role="Voice authenticity",
                name=settings.voice_model_id,
                revision=settings.effective_voice_revision,
                license="Apache-2.0 (as stated on the model page)",
                loaded=services.voice.loaded,
                details="wav2vec2 XLSR-53 classifier with two labels, real and fake. Loaded from safetensors without remote code.",
            ),
            _scam_status(settings, services),
        ]
    )

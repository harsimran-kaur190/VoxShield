from fastapi import APIRouter

from fastapi.responses import JSONResponse

from app.config import get_settings
from app.schemas import HealthResponse, LanguageChoice, LimitsResponse
from app.services.audio_validation import ALLOWED_EXTENSIONS
from app.services.languages import AUTO, SCAM_DETECTION_LANGUAGES, SELECTABLE, TRANSLATED_SCAM_LANGUAGES

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="voxshield-api", version=get_settings().app_version)


@router.get("/ready")
def ready() -> JSONResponse:
    """200 once every configured model is loaded. Use /health for liveness: it answers while models are still loading."""
    from app.dependencies import get_services

    services = get_services()
    parts = {"speech_to_text": services.transcriber.loaded, "voice": services.voice.loaded, "scam_intent": getattr(services.intent, "loaded", True)}
    ok = all(parts.values())
    return JSONResponse({"status": "ready" if ok else "loading", "models": parts}, status_code=200 if ok else 503)


@router.get("/limits", response_model=LimitsResponse)
def limits() -> LimitsResponse:
    settings = get_settings()
    return LimitsResponse(
        max_upload_mb=settings.max_upload_mb,
        min_duration_seconds=settings.min_duration_seconds,
        max_duration_seconds=settings.max_duration_seconds,
        allowed_extensions=sorted(ALLOWED_EXTENSIONS),
        languages=[
            LanguageChoice(
                code=o.code,
                name=o.name,
                scam_detection_validated=None if o.code == AUTO else o.code in SCAM_DETECTION_LANGUAGES,
                scam_detection=None if o.code == AUTO else "direct" if o.code in SCAM_DETECTION_LANGUAGES
                else "translated" if o.code in TRANSLATED_SCAM_LANGUAGES else None,
            )
            for o in SELECTABLE
        ],
    )

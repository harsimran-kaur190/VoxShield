import logging
import shutil
import tempfile
import threading
import time
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import analysis, calls, health, models, uploads
from app.config import get_settings
from app.middleware import ApiGuard

logger = logging.getLogger("voxshield")


def _preload() -> None:
    """Load both models in parallel so the first real request does not pay for it."""
    from app.dependencies import get_services

    services = get_services()
    try:  # importing these from several threads at once can fail half-way, so do it once, first
        import torch  # noqa: F401
        import transformers  # noqa: F401
        from transformers import AutoFeatureExtractor, AutoModelForAudioClassification, AutoModelForSequenceClassification, AutoTokenizer  # noqa: F401
    except Exception as error:
        logger.error("Could not import the model libraries: %s", type(error).__name__)

    def load(name: str, loader) -> None:
        try:
            loader()
            logger.info("Preloaded %s model", name)
        except Exception as error:
            logger.error("Preload of %s model failed: %s", name, type(error).__name__)

    loaders = [("speech-to-text", services.transcriber.ensure_loaded), ("voice", services.voice.ensure_loaded)]
    if hasattr(services.intent, "ensure_loaded"):
        loaders.append(("scam-intent", services.intent.ensure_loaded))
    threads = [threading.Thread(target=load, args=(name, loader), daemon=True) for name, loader in loaders]
    for thread in threads:
        thread.start()


STALE_TEMP_SECONDS = 3600


def sweep_stale_uploads(max_age_seconds: float = STALE_TEMP_SECONDS) -> int:
    """Delete upload folders left behind by a crashed process. Only touches voxshield-* folders older than max_age."""
    removed = 0
    for folder in Path(tempfile.gettempdir()).glob("voxshield-*"):
        try:
            if folder.is_dir() and time.time() - folder.stat().st_mtime > max_age_seconds:
                shutil.rmtree(folder, ignore_errors=True)
                removed += 1
        except OSError:
            continue
    return removed


@asynccontextmanager
async def lifespan(app: FastAPI):
    sweep_stale_uploads()
    if get_settings().preload_models:
        threading.Thread(target=_preload, daemon=True).start()
    yield
    calls.get_registry().close_all()  # drop every live call's audio buffer


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="VoxShield API",
        description="Beyond the Voice. Into the Truth.",
        version=settings.app_version,
        lifespan=lifespan,
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    # Added last, so it is the outermost layer: floods and oversized bodies are turned away before anything else runs.
    app.add_middleware(ApiGuard, max_upload_bytes=settings.max_upload_bytes, requests_per_minute=settings.rate_limit_per_minute)

    for router in (health.router, uploads.router, analysis.router, models.router, calls.router):
        app.include_router(router, prefix="/api/v1")
    return app


app = create_app()

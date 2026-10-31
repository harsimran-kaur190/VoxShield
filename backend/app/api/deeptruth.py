"""DeepTruth: one upload endpoint for images, audio clips and videos.

The file is saved, its real type is read from its bytes, and it is routed to the matching pipeline: audio to VoxShield's
voice detector, images to the face + classifier + forensics module, videos to the frame, consistency, voice and
audio-visual sync checks. All of them return the common ModuleResult format and are fused into one report."""

import time

from fastapi import APIRouter, Depends, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.config import get_settings
from app.deeptruth.dependencies import ImageComponents, get_image_components
from app.deeptruth.fusion.fuse import fuse
from app.deeptruth.modules.audio_analysis import analyze_audio
from app.deeptruth.modules.image_analysis import analyze_image
from app.deeptruth.modules.video_analysis import analyze_video
from app.deeptruth.preprocess import detect_type
from app.deeptruth.schemas import DeepTruthReport, MediaInfo
from app.errors import UploadError
from app.schemas import ErrorBody
from app.services.audio_io import AudioDecodeError, load_mono_16k
from app.services.interfaces import VoiceAuthenticityClassifier
from app.services.upload_handling import save_upload

router = APIRouter(prefix="/deeptruth", tags=["deeptruth"])
ERROR_RESPONSES = {code: {"model": ErrorBody} for code in (413, 415, 422)}

SUPPORTED_KINDS = ("audio", "image", "video")


class DeepTruthLimits(BaseModel):
    max_upload_mb: int
    max_duration_seconds: float
    extensions: dict[str, list[str]]
    supported_kinds: list[str]


def get_voice() -> VoiceAuthenticityClassifier:
    """The same loaded voice detector VoxShield uses, so the model is held in memory once."""
    from app.dependencies import get_services

    return get_services().voice


@router.get("/limits", response_model=DeepTruthLimits)
def limits() -> DeepTruthLimits:
    settings = get_settings()
    return DeepTruthLimits(
        max_upload_mb=settings.deeptruth_max_upload_mb,
        max_duration_seconds=settings.max_duration_seconds,
        extensions={
            "image": sorted(detect_type.IMAGE_EXTENSIONS),
            "audio": sorted(detect_type.AUDIO_EXTENSIONS),
            "video": sorted(detect_type.VIDEO_EXTENSIONS),
        },
        supported_kinds=list(SUPPORTED_KINDS),
    )


@router.post("/analyze", response_model=DeepTruthReport, responses=ERROR_RESPONSES)
async def analyze(file: UploadFile, voice: VoiceAuthenticityClassifier = Depends(get_voice), image: ImageComponents = Depends(get_image_components)) -> DeepTruthReport:
    """Detect the media type, run the matching pipeline, and return one fused report."""
    settings = get_settings()
    detect_type.check_extension(file.filename)
    started = time.perf_counter()
    workdir, path, size = await save_upload(file, settings, max_mb=settings.deeptruth_max_upload_mb)
    try:
        media = detect_type.detect_media(path, file.filename, size)
        if media.kind == "image":
            return await run_in_threadpool(_analyze_image_file, path, media, image, settings, started)
        _check_duration(media, settings)
        if media.kind == "video":
            return await run_in_threadpool(_analyze_video_file, path, media, image, voice, settings, started)
        return await run_in_threadpool(_analyze_audio_file, path, media, voice, settings, started)
    finally:
        workdir.cleanup()


def _analyze_audio_file(path, media: MediaInfo, voice: VoiceAuthenticityClassifier, settings, started: float) -> DeepTruthReport:
    timings: dict[str, float] = {}
    t = time.perf_counter()
    try:
        audio = load_mono_16k(path, max_seconds=settings.max_duration_seconds * 1.05 + 1)
    except AudioDecodeError as error:
        raise UploadError(422, "decode_failed", str(error)) from error
    timings["decode"] = round(time.perf_counter() - t, 2)
    if media.duration_seconds is None:
        media = media.model_copy(update={"duration_seconds": round(len(audio) / 16_000, 2)})
    t = time.perf_counter()
    module = analyze_audio(audio, voice, media)
    timings["audio"] = round(time.perf_counter() - t, 2)
    timings["total"] = round(time.perf_counter() - started, 2)
    return fuse([module], media, timings)


def _analyze_image_file(path, media: MediaInfo, image: ImageComponents, settings, started: float) -> DeepTruthReport:
    t = time.perf_counter()
    module, media = analyze_image(path, image.classifiers, image.faces, media, max_side=settings.image_max_side)
    timings = {"image": round(time.perf_counter() - t, 2), "total": round(time.perf_counter() - started, 2)}
    return fuse([module], media, timings)


def _analyze_video_file(path, media: MediaInfo, image: ImageComponents, voice: VoiceAuthenticityClassifier, settings, started: float) -> DeepTruthReport:
    modules, extra, timings = analyze_video(path, media, image.classifiers, image.faces, voice, settings)
    timings["total"] = round(time.perf_counter() - started, 2)
    report = fuse(modules, media, timings)
    # Video-level facts (truncation, decode failures) go first: they apply to every module.
    return report.model_copy(update={"limitations": [*extra, *[x for x in report.limitations if x not in extra]]})


def _check_duration(media: MediaInfo, settings) -> None:
    duration = media.duration_seconds
    if duration is None:
        return
    if duration < settings.min_duration_seconds:
        raise UploadError(422, "too_short", f"Media must be at least {settings.min_duration_seconds:g} second(s) long.")
    if duration > settings.max_duration_seconds:
        raise UploadError(422, "too_long", f"Media must be no longer than {settings.max_duration_seconds / 60:g} minutes.")


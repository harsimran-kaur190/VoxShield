"""Video pipeline: one pass over the frames feeds three checks, and the audio track feeds two more.

    frames (10 per second, first 60 s) --> face track --+--> frame-to-frame consistency
                                                        +--> audio-visual sync (with the audio's loudness)
    ~16 evenly spaced frames --> image detector (UnivFD, whole frame) --> video-frames module
    audio track --> VoxShield voice detector --> audio module

Everything is computed while the frames stream past; no frame is kept in memory after it is processed."""

import logging
import time
from collections.abc import Sequence

import numpy as np
from PIL import Image

from app.config import Settings
from app.deeptruth.modules.audio_analysis import analyze_audio
from app.deeptruth.modules.face_analysis import Face, FaceFinder
from app.deeptruth.modules.image_classifier import ImageDeepfakeClassifier
from app.deeptruth.modules.lipsync import build_lipsync_module
from app.deeptruth.modules.video_frames import FrameReading, build_frames_module
from app.deeptruth.modules.video_temporal import build_temporal_module
from app.deeptruth.preprocess.extract_audio import AudioDecodeError, extract_audio
from app.deeptruth.preprocess.frames import VideoDecodeError, iter_frames
from app.deeptruth.schemas import MediaInfo, ModuleResult
from app.services.interfaces import ComponentFailure, VoiceAuthenticityClassifier

logger = logging.getLogger("deeptruth.video")


def analyze_video(
    path,
    media: MediaInfo,
    classifiers: Sequence[ImageDeepfakeClassifier],
    faces: FaceFinder,
    voice: VoiceAuthenticityClassifier,
    settings: Settings,
) -> tuple[list[ModuleResult], list[str], dict[str, float]]:
    """Returns (modules, extra limitations, timings). Never raises for model or decoding problems."""
    timings: dict[str, float] = {}
    extra: list[str] = []
    spacing = 1.0 / settings.video_sample_fps
    analyzed = min(media.duration_seconds or settings.video_max_analyzed_seconds, settings.video_max_analyzed_seconds)
    if media.duration_seconds and media.duration_seconds > settings.video_max_analyzed_seconds:
        extra.append(
            f"Only the first {settings.video_max_analyzed_seconds:g} s of this {media.duration_seconds:g} s video were checked frame by frame; "
            "the voice check covers the whole audio track."
        )

    # ---- one pass over the frames
    started = time.perf_counter()
    targets = list(np.linspace(0, max(analyzed - spacing, 0), settings.video_classifier_frames))
    track: list[tuple[float, Face | None]] = []
    readings: list[FrameReading] = []
    face_error: str | None = None
    size = (media.width or 0, media.height or 0)
    try:
        for t, rgb in iter_frames(path, settings.video_sample_fps, settings.video_max_analyzed_seconds, settings.video_frame_max_side):
            size = (rgb.shape[1], rgb.shape[0])
            face = None
            if face_error is None:
                try:
                    found = faces.detect(rgb)
                    face = found[0] if found else None
                except ComponentFailure as failure:
                    face_error = failure.message
                except Exception as error:
                    logger.error("face detection failed: %s", type(error).__name__)
                    face_error = "Face detection failed unexpectedly."
            track.append((t, face))
            # A frame takes a classifier target within half a sample step, so frame-timing jitter never skips one.
            if targets and t + spacing / 2 >= targets[0]:
                while targets and t + spacing / 2 >= targets[0]:
                    targets.pop(0)
                readings.append(_classify(rgb, face, t, classifiers))
    except VideoDecodeError as error:
        extra.append(f"The video frames could not be decoded ({error}); only the audio was checked.")
    timings["frames"] = round(time.perf_counter() - started, 2)
    if face_error:
        extra.append(f"Face detection did not run on the video ({face_error}).")

    modules: list[ModuleResult] = []
    if track:
        with_face = sum(f is not None for _, f in track)
        modules.append(build_frames_module(readings, media, analyzed / max(settings.video_classifier_frames, 1), len(track), with_face))
        modules.append(build_temporal_module(track, spacing, *size))

    # ---- audio track
    if media.has_audio:
        started = time.perf_counter()
        try:
            audio = extract_audio(path, settings.max_duration_seconds * 1.05 + 1)
        except AudioDecodeError as error:
            audio = None
            extra.append(f"The audio track could not be decoded ({error}), so the voice and sync checks did not run.")
        timings["audio_decode"] = round(time.perf_counter() - started, 2)
        if audio is not None:
            started = time.perf_counter()
            modules.append(analyze_audio(audio, voice, media))
            timings["audio"] = round(time.perf_counter() - started, 2)
            if track:
                modules.append(build_lipsync_module(track, audio, spacing))
    return modules, extra, timings


def _classify(rgb: np.ndarray, face: Face | None, t: float, classifiers: Sequence[ImageDeepfakeClassifier]) -> FrameReading:
    # The whole frame, as for photos: UnivFD was trained and checked on whole images, not face crops.
    target = Image.fromarray(rgb)
    reading = FrameReading(time=t, on_face=face is not None, face_px=int(face.width_fraction * rgb.shape[1]) if face is not None else None)
    for clf in classifiers:
        try:
            reading.probabilities[clf.name] = clf.fake_probability(target)
        except ComponentFailure as failure:
            reading.errors[clf.name] = failure.message
        except Exception as error:
            logger.error("frame classifier %s failed: %s", clf.name, type(error).__name__)
            reading.errors[clf.name] = "The classifier failed unexpectedly."
    return reading

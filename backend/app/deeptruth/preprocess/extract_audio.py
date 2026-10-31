"""Extract a video's audio track as 16 kHz mono float32.

VoxShield's PyAV decoder already reads the audio stream of any container (MP4, MOV, WebM, MKV, AVI), so it is reused
here instead of MoviePy: no extra dependency, no separate ffmpeg install, and exactly the same decoding as the audio
pipeline, which keeps a video's voice score comparable with the same clip uploaded as audio."""

from pathlib import Path

import numpy as np

from app.services.audio_io import AudioDecodeError, load_mono_16k

__all__ = ["AudioDecodeError", "extract_audio"]


def extract_audio(path: Path, max_seconds: float) -> np.ndarray:
    """Raises AudioDecodeError when there is no audio stream or it cannot be decoded."""
    return load_mono_16k(path, max_seconds=max_seconds)

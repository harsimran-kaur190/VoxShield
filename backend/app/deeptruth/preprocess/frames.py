"""Sample frames from a video with OpenCV.

Frames are read in order and kept at a fixed rate (default 10 per second), converted to RGB and scaled down. They are
yielded one at a time and never stored as a list, so a long or high-resolution video does not fill the memory."""

from collections.abc import Iterator
from pathlib import Path

import cv2
import numpy as np


class VideoDecodeError(Exception):
    pass


def iter_frames(path: Path, sample_fps: float, max_seconds: float, max_side: int) -> Iterator[tuple[float, np.ndarray]]:
    """Yield (time in seconds, RGB uint8 frame) at about `sample_fps`, for the first `max_seconds` of the video."""
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise VideoDecodeError("The video could not be opened.")
    step = 1.0 / sample_fps
    next_time = 0.0
    yielded = 0
    try:
        while capture.grab():  # grab() advances without converting the frame; retrieve() only for kept frames
            time = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            if time > max_seconds:
                break
            if time + 1e-6 < next_time:
                continue
            ok, bgr = capture.retrieve()
            if not ok or bgr is None:
                continue
            next_time = max(next_time + step, time + step / 2)  # stays on the grid; never yields twice for one frame
            yielded += 1
            yield time, _to_rgb(bgr, max_side)
    finally:
        capture.release()
    if yielded == 0:
        raise VideoDecodeError("No frames could be decoded from the video.")


def _to_rgb(bgr: np.ndarray, max_side: int) -> np.ndarray:
    h, w = bgr.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale < 1.0:
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

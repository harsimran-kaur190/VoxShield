"""Face detection and landmarks with MediaPipe Face Landmarker (478 points per face).

Used for three things: cropping the face for the learned classifier, simple geometry checks shown as evidence, and
(in Phase 4) mouth openness over time for the audio-visual sync check. The model file is fetched once from Google's
public bucket and verified by SHA-256."""

import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from app.config import Settings
from app.deeptruth.download import ensure_file
from app.services.interfaces import ComponentFailure

logger = logging.getLogger("deeptruth.face")

# MediaPipe face mesh indices. Left/right are the subject's own left and right.
LEFT_EYE_OUTER, RIGHT_EYE_OUTER = 263, 33
UPPER_LIP_INNER, LOWER_LIP_INNER = 13, 14
MOUTH_LEFT, MOUTH_RIGHT = 291, 61
CHIN, FOREHEAD = 152, 10
# Mirror pairs used for the symmetry check: (left, right).
SYMMETRY_PAIRS = ((263, 33), (362, 133), (386, 159), (374, 145), (291, 61), (454, 234), (323, 93), (397, 172), (288, 58))


@dataclass
class Face:
    """One detected face. Coordinates are fractions of the image width/height (0-1), so they survive resizing."""

    landmarks: np.ndarray  # (478, 2) normalized x, y
    box: tuple[float, float, float, float]  # x, y, w, h normalized

    @property
    def width_fraction(self) -> float:
        return self.box[2]

    def mouth_openness(self) -> float:
        """Inner-lip gap divided by face height. Roughly 0 closed, 0.1+ clearly open. Phase 4 uses this per frame."""
        lips = abs(self.landmarks[LOWER_LIP_INNER, 1] - self.landmarks[UPPER_LIP_INNER, 1])
        height = abs(self.landmarks[CHIN, 1] - self.landmarks[FOREHEAD, 1]) or 1e-6
        return float(lips / height)

    def asymmetry(self) -> float:
        """Mean mirror error of paired landmarks about the face's vertical midline, as a fraction of face width.
        Real faces are not perfectly symmetric; values above about 0.08 are unusual and worth a look."""
        xs = self.landmarks[:, 0]
        mid = (xs[LEFT_EYE_OUTER] + xs[RIGHT_EYE_OUTER]) / 2
        width = abs(xs[LEFT_EYE_OUTER] - xs[RIGHT_EYE_OUTER]) or 1e-6
        errors = [abs((xs[left] - mid) + (xs[right] - mid)) for left, right in SYMMETRY_PAIRS]
        return float(np.mean(errors) / width)

    def metrics(self, image_width: int, image_height: int) -> dict[str, Any]:
        return {
            "box": {"x": round(self.box[0], 4), "y": round(self.box[1], 4), "w": round(self.box[2], 4), "h": round(self.box[3], 4)},
            "width_px": int(self.box[2] * image_width),
            "height_px": int(self.box[3] * image_height),
            "asymmetry": round(self.asymmetry(), 4),
            "mouth_openness": round(self.mouth_openness(), 4),
        }


class FaceFinder(Protocol):
    def detect(self, rgb: np.ndarray) -> list[Face]: ...


class MediaPipeFaceFinder:
    def __init__(self, settings: Settings):
        self._path = Path(settings.face_landmarker_path)
        self._url, self._sha = settings.face_landmarker_url, settings.face_landmarker_sha256
        self._max_faces = settings.face_max_faces
        self._lock = threading.Lock()
        self._landmarker: Any = None
        self.loaded = False

    def ensure_loaded(self) -> None:
        with self._lock:
            if self._landmarker is not None:
                return
            try:
                self._ensure_model_file()
                import mediapipe as mp
                from mediapipe.tasks.python import BaseOptions, vision

                options = vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(self._path)), num_faces=self._max_faces)
                self._landmarker = vision.FaceLandmarker.create_from_options(options)
                self._mp = mp
            except Exception as error:
                logger.error("face landmarker failed to load: %s", type(error).__name__)
                raise ComponentFailure("face_model_failed", "The face landmark model could not be loaded.") from error
            self.loaded = True

    def _ensure_model_file(self) -> None:
        ensure_file(self._path, self._url, self._sha)

    def detect(self, rgb: np.ndarray) -> list[Face]:
        """Faces in an RGB uint8 array (H, W, 3), largest first. MediaPipe's graph is not thread-safe, hence the lock."""
        self.ensure_loaded()
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        with self._lock:
            result = self._landmarker.detect(image)
        faces = [face_from_landmarks(np.array([(p.x, p.y) for p in points], dtype=np.float32)) for points in result.face_landmarks]
        return sorted(faces, key=lambda f: f.width_fraction, reverse=True)


def face_from_landmarks(points: np.ndarray) -> Face:
    x0, y0 = points.min(axis=0)
    x1, y1 = points.max(axis=0)
    return Face(landmarks=points, box=(float(x0), float(y0), float(x1 - x0), float(y1 - y0)))


def crop_face(rgb: np.ndarray, face: Face, margin: float = 0.35) -> np.ndarray:
    """The face box grown by `margin` on every side (the classifiers saw loosely cropped faces in training)."""
    h, w = rgb.shape[:2]
    x, y, bw, bh = face.box
    x0, y0 = max(int((x - bw * margin) * w), 0), max(int((y - bh * margin) * h), 0)
    x1, y1 = min(int((x + bw * (1 + margin)) * w), w), min(int((y + bh * (1 + margin)) * h), h)
    return rgb[y0:y1, x0:x1]

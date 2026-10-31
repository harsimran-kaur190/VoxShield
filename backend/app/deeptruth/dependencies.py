"""DeepTruth's model components, created once per process and shared with VoxShield's loaded voice detector."""

from dataclasses import dataclass
from functools import lru_cache

from app.config import get_settings
from app.deeptruth.modules.face_analysis import MediaPipeFaceFinder
from app.deeptruth.modules.image_classifier import ImageDeepfakeClassifier, build_image_classifiers


@dataclass
class ImageComponents:
    classifiers: list[ImageDeepfakeClassifier]
    faces: MediaPipeFaceFinder


@lru_cache
def get_image_components() -> ImageComponents:
    settings = get_settings()
    return ImageComponents(build_image_classifiers(settings), MediaPipeFaceFinder(settings))

"""The learned image detectors: a generic Hugging Face image-classifier wrapper, and the ensemble that combines UnivFD
with a Swin-V2 AI-image classifier.

Models load once, lazily, from pinned safetensors weights with no remote code. Labels are mapped by name ("fake",
"artificial", "ai" versus "real", "human"), so a different two-class model can be swapped in through settings."""

import logging
import math
import threading
import time
from typing import Any, Protocol

from PIL import Image

from app.config import Settings
from app.services.interfaces import ComponentFailure

logger = logging.getLogger("deeptruth.image_model")

FAKE_HINTS = ("fake", "synthetic", "generated", "artificial", "ai")
REAL_HINTS = ("real", "realism", "genuine", "human", "hum", "authentic")


class ImageDeepfakeClassifier(Protocol):
    name: str

    def fake_probability(self, image: Image.Image) -> float: ...


def _label_index(id2label: dict[Any, str], hints: tuple[str, ...]) -> int | None:
    # Short hints ("ai", "hum") must match the whole label, or "ai" would also match "pAIr" and the like.
    matches = [int(i) for i, name in id2label.items() if any((h == str(name).lower()) if len(h) <= 3 else (h in str(name).lower()) for h in hints)]
    return matches[0] if len(matches) == 1 else None


class HfImageClassifier:
    def __init__(self, model_id: str, revision: str | None, device: str = "cpu"):
        self.name, self._revision, self._device = model_id, revision, device
        self._lock = threading.Lock()
        self._loaded: Any = None
        self.loaded = False
        self.load_seconds: float | None = None

    def ensure_loaded(self) -> None:
        with self._lock:
            if self._loaded is not None:
                return
            started = time.perf_counter()
            try:
                import torch
                from transformers import AutoImageProcessor, AutoModelForImageClassification

                processor = AutoImageProcessor.from_pretrained(self.name, revision=self._revision)
                model = AutoModelForImageClassification.from_pretrained(self.name, revision=self._revision, use_safetensors=True, trust_remote_code=False)
                model.to(self._device).eval()
                id2label = model.config.id2label
                fake, real = _label_index(id2label, FAKE_HINTS), _label_index(id2label, REAL_HINTS)
                if len(id2label) != 2 or fake is None or real is None or fake == real:
                    raise ValueError(f"Could not map labels {id2label} to real/fake")
                torch.set_grad_enabled(False)
                self._loaded = (processor, model, fake)
            except Exception as error:
                logger.error("image model %s failed to load: %s", self.name, type(error).__name__)
                raise ComponentFailure("model_load_failed", "The image deepfake classifier could not be loaded.") from error
            self.load_seconds = round(time.perf_counter() - started, 2)
            self.loaded = True

    def fake_probability(self, image: Image.Image) -> float:
        """Softmax probability of the model's 'fake' label for one RGB image. The model resizes to 224x224 itself."""
        self.ensure_loaded()
        processor, model, fake_index = self._loaded
        import torch

        inputs = processor(images=image.convert("RGB"), return_tensors="pt").to(self._device)
        with torch.inference_mode():
            logits = model(**inputs).logits[0]
        return float(torch.softmax(logits.float(), dim=-1)[fake_index])


def _logit(p: float) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


class LogitEnsemble:
    """Two detectors with complementary blind spots, combined by averaging their logits and calibrating the result.

    Why: on DeepTruth's labelled set UnivFD ranks StyleGAN faces well (AUC 0.86) but is at chance on 2025 generators
    (0.41), while the Swin-V2 model is the reverse (0.40 / 0.91). Their mean logit scored 0.80 on the calibration half,
    better than either alone (eval/results/detector_comparison.json). Each member's raw output is kept for the
    evidence panel. If one member fails, the other's logit is used alone and the failure is reported."""

    def __init__(self, members: list, a: float, b: float, name: str = "UnivFD + Swin-V2 ensemble (mean of logits)"):
        self.members, self._a, self._b, self.name = members, a, b, name
        self.last_members: list[dict] = []  # [{model, raw_output, error}] from the most recent call
        self.last_raw: float | None = None  # mean raw probability, for display

    @property
    def loaded(self) -> bool:
        return all(getattr(m, "loaded", False) for m in self.members)

    def ensure_loaded(self) -> None:
        for member in self.members:
            member.ensure_loaded()

    def fake_probability(self, image: Image.Image) -> float:
        logits, readings = [], []
        for member in self.members:
            try:
                raw = member.raw_probability(image) if hasattr(member, "raw_probability") else member.fake_probability(image)
                logits.append(_logit(raw))
                readings.append({"model": member.name, "raw_output": round(raw, 5), "error": None})
            except ComponentFailure as failure:
                readings.append({"model": member.name, "raw_output": None, "error": failure.message})
        self.last_members = readings
        if not logits:
            raise ComponentFailure("model_load_failed", "No image detector could run.")
        self.last_raw = round(float(sum(1 / (1 + math.exp(-z)) for z in logits) / len(logits)), 5)
        z = self._a * (sum(logits) / len(logits)) + self._b
        return 1 / (1 + math.exp(-z))


def build_image_classifiers(settings: Settings) -> list:
    """The image detector(s) used for photos and video frames: the ensemble by default, UnivFD alone or the ViT pair
    on request (VOXSHIELD_IMAGE_DETECTOR)."""
    if settings.image_detector in ("ensemble", "univfd"):
        from app.deeptruth.modules.univfd import UnivFDClassifier

        univfd = UnivFDClassifier(settings)
        if settings.image_detector == "univfd":
            return [univfd]
        swin = HfImageClassifier(settings.swin_model_id, settings.swin_model_revision, settings.image_device)
        return [LogitEnsemble([univfd, swin], settings.ensemble_calibration_a, settings.ensemble_calibration_b)]
    detectors = [HfImageClassifier(settings.image_model_id, settings.image_model_revision, settings.image_device)]
    if settings.image_secondary_model_id:
        detectors.append(HfImageClassifier(settings.image_secondary_model_id, settings.image_secondary_model_revision, settings.image_device))
    return detectors

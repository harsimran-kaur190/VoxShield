"""UnivFD: the learned image detector (Ojha, Li and Lee, "Towards Universal Fake Image Detectors that Generalize
Across Generative Models", CVPR 2023).

How it works, in one line: OpenAI's CLIP ViT-L/14 turns the image into a 768-number description, and a single linear
layer trained by the authors on real versus ProGAN-generated images turns that description into a "fake" logit.
Because CLIP was not trained to spot fakes, the description is general, and the paper shows the detector carries
over to GANs and diffusion models it never saw.

Weights: CLIP from Hugging Face (openai/clip-vit-large-patch14, pinned revision, safetensors). The 3 KB linear layer
from the authors' GitHub repository (MIT), pinned to a commit and checked by SHA-256, loaded with weights_only=True.

Calibration: the raw sigmoid output is heavily skewed towards "real" (most fakes score below 0.1), so it is mapped with
a logistic curve, score = sigmoid(a * logit(raw) + b), fitted on half of a labelled sample and checked on the other
half by backend/evaluation/image_detector_check.py. Its results are in backend/evaluation/IMAGE_RESULTS.md."""

import logging
import math
import threading
import time
from pathlib import Path
from typing import Any

from PIL import Image

from app.config import Settings
from app.deeptruth.download import ensure_file
from app.services.interfaces import ComponentFailure

logger = logging.getLogger("deeptruth.univfd")

CROP = 224  # UnivFD's evaluation centre-crops 224 px without resizing; smaller images are scaled up to 224 first


def calibrate(raw: float, a: float, b: float) -> float:
    """Map UnivFD's raw p(fake) to the calibrated 0-1 score. 0.5 is the decision point fitted on the sample."""
    raw = min(max(raw, 1e-6), 1 - 1e-6)
    z = a * math.log(raw / (1 - raw)) + b
    return 1 / (1 + math.exp(-z))


class UnivFDClassifier:
    name = "UnivFD (CLIP ViT-L/14 + linear probe)"

    def __init__(self, settings: Settings):
        self._clip_id, self._clip_revision = settings.univfd_clip_id, settings.univfd_clip_revision
        self._fc_path, self._fc_url, self._fc_sha = Path(settings.univfd_fc_path), settings.univfd_fc_url, settings.univfd_fc_sha256
        self._a, self._b = settings.univfd_calibration_a, settings.univfd_calibration_b
        self._device = settings.image_device
        self._lock = threading.Lock()
        self._loaded: Any = None
        self.loaded = False
        self.load_seconds: float | None = None
        self.last_raw: float | None = None  # the uncalibrated output of the most recent call, for the evidence panel

    def ensure_loaded(self) -> None:
        with self._lock:
            if self._loaded is not None:
                return
            started = time.perf_counter()
            try:
                import torch
                from transformers import CLIPImageProcessor, CLIPVisionModelWithProjection

                fc = torch.load(ensure_file(self._fc_path, self._fc_url, self._fc_sha), map_location="cpu", weights_only=True)
                if tuple(fc["weight"].shape) != (1, 768) or tuple(fc["bias"].shape) != (1,):
                    raise ValueError("unexpected UnivFD linear layer shape")
                processor = CLIPImageProcessor.from_pretrained(self._clip_id, revision=self._clip_revision)
                model = CLIPVisionModelWithProjection.from_pretrained(self._clip_id, revision=self._clip_revision, use_safetensors=True)
                model.to(self._device).eval()
                torch.set_grad_enabled(False)
                self._loaded = (processor, model, fc["weight"].to(self._device), fc["bias"].to(self._device))
            except Exception as error:
                logger.error("UnivFD failed to load: %s", type(error).__name__)
                raise ComponentFailure("model_load_failed", "The UnivFD image detector could not be loaded.") from error
            self.load_seconds = round(time.perf_counter() - started, 2)
            self.loaded = True

    def raw_probability(self, image: Image.Image) -> float:
        """UnivFD's own sigmoid output, before calibration."""
        self.ensure_loaded()
        processor, model, weight, bias = self._loaded
        import torch

        image = image.convert("RGB")
        if min(image.size) < CROP:  # a centre crop of a smaller image would be padded with black
            scale = CROP / min(image.size)
            image = image.resize((max(round(image.width * scale), CROP), max(round(image.height * scale), CROP)), Image.BICUBIC)
        inputs = processor(images=image, return_tensors="pt", do_resize=False, do_center_crop=True, crop_size={"height": CROP, "width": CROP}).to(self._device)
        with torch.inference_mode():
            logit = model(**inputs).image_embeds @ weight.T + bias
        return float(torch.sigmoid(logit.float()).item())

    def fake_probability(self, image: Image.Image) -> float:
        """The calibrated score DeepTruth uses (0.5 = decision point). The raw value is kept in `last_raw`."""
        raw = self.raw_probability(image)
        self.last_raw = raw
        return calibrate(raw, self._a, self._b)

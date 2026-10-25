import logging
import statistics
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.config import Settings
from app.schemas_analysis import ModelInfo, VoiceAssessment, VoiceWindow
from app.services.audio_io import TARGET_SAMPLE_RATE
from app.services.interfaces import Audio16k, ComponentFailure

logger = logging.getLogger("voxshield.voice")

FAKE_LABEL_HINTS = ("fake", "spoof", "synthetic", "deepfake", "generated")
REAL_LABEL_HINTS = ("real", "bonafide", "bona", "genuine", "human", "authentic")

SPOT_CHECK = (
    "Informal spot check, not an evaluation: the model favored 'fake' for 3 of 11 real human recordings "
    "(10 clean audiobook clips from one speaker plus one 1961 speech) and favored 'real' for 1 of 12 macOS "
    "text-to-speech voices. The sample was tiny and unlike phone calls or modern voice cloning."
)

LIMITATIONS = [
    "The model was fine-tuned on a public benchmark (ASVspoof 2019). Newer voice-cloning systems may not be detected.",
    "Scores swing with window length and position. Phone compression, noise, and music can also move them.",
]


@dataclass
class LoadedClassifier:
    extractor: Any
    model: Any
    fake_index: int


def _label_index(id2label: dict[Any, str], hints: tuple[str, ...]) -> int | None:
    matches = [int(i) for i, name in id2label.items() if any(h in str(name).lower() for h in hints)]
    return matches[0] if len(matches) == 1 else None


def _default_loader(settings: Settings) -> LoadedClassifier:
    import torch
    from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

    revision = settings.effective_voice_revision
    extractor = AutoFeatureExtractor.from_pretrained(settings.voice_model_id, revision=revision)
    model = AutoModelForAudioClassification.from_pretrained(
        settings.voice_model_id, revision=revision, use_safetensors=True, trust_remote_code=False
    )
    model.to(settings.voice_device).eval()
    id2label = model.config.id2label
    fake_index = _label_index(id2label, FAKE_LABEL_HINTS)
    real_index = _label_index(id2label, REAL_LABEL_HINTS)
    if fake_index is None or real_index is None or fake_index == real_index or len(id2label) != 2:
        raise ValueError("Could not map the model's labels to real/fake")
    torch.set_grad_enabled(False)
    return LoadedClassifier(extractor=extractor, model=model, fake_index=fake_index)


def plan_windows(audio: Audio16k, settings: Settings) -> list[tuple[int, int]]:
    """Return (start, end) sample ranges: fixed-length windows, quiet ones skipped, evenly thinned to a cap."""
    size = int(settings.voice_window_seconds * TARGET_SAMPLE_RATE)
    minimum = int(settings.voice_min_window_seconds * TARGET_SAMPLE_RATE)
    ranges = [(s, min(s + size, len(audio))) for s in range(0, len(audio), size)]
    ranges = [(s, e) for s, e in ranges if e - s >= minimum]
    ranges = [(s, e) for s, e in ranges if float(np.sqrt(np.mean(audio[s:e] ** 2))) >= settings.voice_silence_rms]
    if len(ranges) > settings.voice_max_windows:
        picks = np.linspace(0, len(ranges) - 1, settings.voice_max_windows).round().astype(int)
        ranges = [ranges[i] for i in sorted(set(picks.tolist()))]
    return ranges


def decide(scores: list[float], settings: Settings) -> str:
    """Fixed, documented heuristic over per-window scores. It is not a calibrated confidence."""
    median = statistics.median(scores)
    if settings.voice_borderline_low <= median <= settings.voice_borderline_high:
        return "inconclusive"
    leaning = sum(score >= 0.5 for score in scores) / len(scores)
    if leaning >= settings.voice_majority_ratio:
        return "model_favors_fake"
    if leaning <= 1 - settings.voice_majority_ratio:
        return "model_favors_real"
    return "inconclusive"


class HfAudioClassifier:
    def __init__(self, settings: Settings, loader: Callable[[Settings], LoadedClassifier] = _default_loader):
        self._settings = settings
        self._loader = loader
        self._loaded: LoadedClassifier | None = None
        self.load_seconds: float | None = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._loaded is not None

    def _model_info(self) -> ModelInfo:
        s = self._settings
        return ModelInfo(
            name=s.voice_model_id,
            revision=s.effective_voice_revision,
            method=(
                f"wav2vec2 sequence classifier on {s.voice_window_seconds:g}s windows of 16 kHz mono audio "
                f"({s.voice_device}); score = two-way softmax over the model's raw logits for the 'fake' label"
            ),
        )

    def ensure_loaded(self) -> LoadedClassifier:
        """Load the model once, even when called from several threads. Records how long the load took."""
        with self._lock:
            if self._loaded is None:
                started = time.perf_counter()
                try:
                    self._loaded = self._loader(self._settings)
                    self.load_seconds = round(time.perf_counter() - started, 2)
                except Exception as error:
                    logger.error("Voice model failed to load: %s", type(error).__name__)
                    raise ComponentFailure(
                        "model_load_failed", "The voice authenticity model could not be loaded."
                    ) from error
            return self._loaded

    def _unavailable_or_inconclusive(self, verdict: str, summary: str, **extra: Any) -> VoiceAssessment:
        return VoiceAssessment(
            verdict=verdict, summary=summary, limitations=LIMITATIONS, reliability_caution=SPOT_CHECK, model=self._model_info(), **extra
        )

    def classify(self, audio: Audio16k) -> VoiceAssessment:
        s = self._settings
        windows = plan_windows(audio, s)
        analyzed_seconds = sum(e - st for st, e in windows) / TARGET_SAMPLE_RATE
        if analyzed_seconds < s.voice_min_audio_seconds:
            return self._unavailable_or_inconclusive(
                "inconclusive",
                f"Not enough audible audio to assess. At least {s.voice_min_audio_seconds:g} seconds are needed "
                f"and {analyzed_seconds:.1f} seconds were usable.",
            )

        loaded = self.ensure_loaded()
        try:
            import torch

            results: list[VoiceWindow] = []
            with self._lock, torch.inference_mode():
                for start, end in windows:
                    inputs = loaded.extractor(
                        audio[start:end], sampling_rate=TARGET_SAMPLE_RATE, return_tensors="pt"
                    )
                    inputs = {k: v.to(s.voice_device) for k, v in inputs.items()}
                    probs = torch.softmax(loaded.model(**inputs).logits, dim=-1)[0]
                    results.append(
                        VoiceWindow(
                            start_seconds=round(start / TARGET_SAMPLE_RATE, 2),
                            end_seconds=round(end / TARGET_SAMPLE_RATE, 2),
                            fake_score=round(float(probs[loaded.fake_index]), 4),
                        )
                    )
        except Exception as error:
            logger.error("Voice inference failed: %s", type(error).__name__)
            raise ComponentFailure("inference_failed", "The voice authenticity model failed while analyzing.") from error

        scores = [w.fake_score for w in results]
        verdict = decide(scores, s)
        leaning = sum(score >= 0.5 for score in scores)
        median = round(statistics.median(scores), 4)
        total = len(scores)
        summaries = {
            "model_favors_fake": f"The model's 'fake' label won in {leaning} of {total} windows. It did the same for some real recordings in VoxShield's spot check.",
            "model_favors_real": f"The model's 'real' label won in {total - leaning} of {total} windows.",
            "inconclusive": "The model's scores were mixed or borderline, so no lean is reported.",
        }
        return VoiceAssessment(
            verdict=verdict,
            summary=summaries[verdict],
            fake_score_median=median,
            fake_score_max=round(max(scores), 4),
            windows_analyzed=len(results),
            windows_favoring_fake=leaning,
            windows=results,
            decision_rule=(
                f"A lean needs at least {s.voice_majority_ratio:.0%} of windows on the same side of 0.5, and a median "
                f"outside {s.voice_borderline_low:g} to {s.voice_borderline_high:g}. These cut-offs are fixed "
                "heuristics, not calibrated confidence levels."
            ),
            reliability_caution=SPOT_CHECK,
            limitations=LIMITATIONS,
            model=self._model_info(),
        )

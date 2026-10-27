import logging
import statistics
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.config import DEFAULT_VOICE_MODEL_ID, Settings
from app.schemas_analysis import ModelInfo, VoiceAssessment, VoiceDetectorResult, VoiceWindow
from app.services.audio_io import TARGET_SAMPLE_RATE
from app.services.interfaces import Audio16k, ComponentFailure

logger = logging.getLogger("voxshield.voice")

FAKE_LABEL_HINTS = ("fake", "spoof", "synthetic", "deepfake", "generated")
REAL_LABEL_HINTS = ("real", "bonafide", "bona", "genuine", "human", "authentic")

SPOT_CHECK = (
    "VoxShield benchmark, not real calls: real read-speech clips (FLEURS) and synthetic clips (MMS neural "
    "text-to-speech and macOS voices) in English and Hindi, scored clean, through a simulated phone channel and through "
    "the iLBC and Opus call codecs. With both detectors on clean audio, no real voice was called fake, every macOS voice "
    "was caught, and neural voices were caught for 95% of English and 72% of Hindi clips. Over phone or VoIP audio most "
    "English neural voices were missed, and about 1 in 7 real English voices were called fake over iLBC. FLEURS is part "
    "of the default model's training data, so the real-voice figures are optimistic. Other languages were not tested."
)

# Ends every "fake" summary; the frontend moves exactly this sentence next to the other methodology notes.
SPOT_CHECK_ASIDE = " On phone-quality audio it did the same for a few real voices in VoxShield's benchmark."
NARROWBAND_CAUTION = (
    " This recording sounds like phone or VoIP audio. Over a VoIP codec the model called up to 3 in 10 real voices "
    "'fake' in VoxShield's benchmark, so treat this lean with extra caution."
)

LIMITATIONS = [
    "Modern neural voices are often missed, especially outside English and over phone-quality audio. A 'real' lean does not "
    "show that a voice is human.",
    "Phone compression and noise make real voices look synthetic more often.",
    "Scores swing with window length and position. Music and overlapping speakers can also move them.",
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


# Below this peak level the recording is treated as digital silence, so near-zero noise is never scaled up into "speech".
SILENT_PEAK = 1e-4

_FRAME = 512  # 32 ms at 16 kHz


def band_measurements(audio: Audio16k) -> dict[str, float] | None:
    """How much of the 4-8 kHz band carries speech, from 32 ms frames of the 16 kHz signal.

    - high_to_low_db: energy above 4 kHz relative to the 300-3400 Hz telephone band, in the loudest frames.
    - high_lift_db: how much louder the band above 4 kHz is in the loudest frames than in the quietest ones.

    A telephone channel removes everything above about 3.4 kHz. Afterwards that band holds only noise, which does not
    rise and fall with the speech, so both numbers are low. Full-band speech has fricatives and harmonics up there that
    rise with the voice. None for audio too short to measure."""
    frames = len(audio) // _FRAME
    if frames < 20:
        return None
    blocks = np.asarray(audio[: frames * _FRAME], dtype=np.float64).reshape(frames, _FRAME) * np.hanning(_FRAME)
    power = np.abs(np.fft.rfft(blocks, axis=1)) ** 2
    freqs = np.fft.rfftfreq(_FRAME, 1 / TARGET_SAMPLE_RATE)
    low = power[:, (freqs >= 300) & (freqs <= 3400)].sum(axis=1) + 1e-12
    high = power[:, (freqs >= 4000) & (freqs <= 7800)].sum(axis=1) + 1e-12
    order = np.argsort(low)
    tenth = max(2, frames // 10)
    loud, quiet = order[-tenth:], order[:tenth]
    return {
        "high_to_low_db": round(float(10 * np.log10(high[loud].sum() / low[loud].sum())), 2),
        "high_lift_db": round(float(10 * np.log10(high[loud].mean() / high[quiet].mean())), 2),
    }


def audio_band(audio: Audio16k, settings: Settings) -> str:
    """"narrowband" for phone or VoIP quality, "full_band" otherwise, "unknown" when too short to tell. In the benchmark
    this marked every simulated phone clip and 93-96% of codec clips as narrowband, and 15% of clean clips too, which
    only means those keep the stricter 0.5 rule."""
    measured = band_measurements(audio)
    if measured is None:
        return "unknown"
    narrow = measured["high_lift_db"] < settings.voice_narrowband_lift_db or measured["high_to_low_db"] < settings.voice_narrowband_ratio_db
    return "narrowband" if narrow else "full_band"


def plan_windows(audio: Audio16k, settings: Settings) -> list[tuple[int, int]]:
    """Return (start, end) sample ranges: fixed-length windows, quiet ones skipped, evenly thinned to a cap.

    "Quiet" is relative to the recording's own peak. The feature extractor normalizes every window anyway, so the
    model never sees the recording level, and an absolute cut-off only threw away softly recorded speech."""
    size = int(settings.voice_window_seconds * TARGET_SAMPLE_RATE)
    minimum = int(settings.voice_min_window_seconds * TARGET_SAMPLE_RATE)
    peak = float(np.max(np.abs(audio))) if len(audio) else 0.0
    if peak < SILENT_PEAK:
        return []
    ranges = [(s, min(s + size, len(audio))) for s in range(0, len(audio), size)]
    ranges = [(s, e) for s, e in ranges if e - s >= minimum]
    ranges = [(s, e) for s, e in ranges if float(np.sqrt(np.mean(audio[s:e] ** 2))) / peak >= settings.voice_silence_rms]
    if len(ranges) > settings.voice_max_windows:
        picks = np.linspace(0, len(ranges) - 1, settings.voice_max_windows).round().astype(int)
        ranges = [ranges[i] for i in sorted(set(picks.tolist()))]
    return ranges


def decide(scores: list[float], settings: Settings, cutoff: float = 0.5) -> str:
    """Fixed, documented heuristic over per-window scores. It is not a calibrated confidence.

    At the default cut-off of 0.5 the borderline band comes from the settings; any other cut-off uses
    +/- voice_full_band_borderline around it."""
    median = statistics.median(scores)
    low, high = (settings.voice_borderline_low, settings.voice_borderline_high) if cutoff == 0.5 else (
        cutoff - settings.voice_full_band_borderline, cutoff + settings.voice_full_band_borderline
    )
    if low <= median <= high:
        return "inconclusive"
    leaning = sum(score >= cutoff for score in scores) / len(scores)
    if leaning >= settings.voice_majority_ratio:
        return "model_favors_fake"
    if leaning <= 1 - settings.voice_majority_ratio:
        return "model_favors_real"
    return "inconclusive"


class HfAudioClassifier:
    def __init__(self, settings: Settings, loader: Callable[[Settings], LoadedClassifier] = _default_loader, band_matched: bool = False):
        self._settings = settings
        self._loader = loader
        # The full-band cut-off was chosen for the default model only, so other detectors keep the 0.5 rule.
        self._band_matched = band_matched and settings.voice_full_band_threshold is not None
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
                f"wav2vec2 classifier on {s.voice_window_seconds:g}s windows of 16 kHz mono audio "
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

        band = audio_band(audio, s)
        cutoff = s.voice_full_band_threshold if self._band_matched and band == "full_band" else 0.5
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
        verdict = decide(scores, s, cutoff)
        leaning = sum(score >= cutoff for score in scores)
        median = round(statistics.median(scores), 4)
        total = len(scores)
        # Below 0.5 the model's own "real" label still wins, so a lean from the lower cut-off is VoxShield's, not the model's.
        fake_lead = (
            f"The model's 'fake' label won in {leaning} of {total} windows."
            if cutoff == 0.5
            else f"{leaning} of {total} windows scored at or above {cutoff:g}, the cut-off VoxShield uses for full-band audio "
            "(the model's own 'fake' label wins only above 0.5)."
        )
        summaries = {
            "model_favors_fake": fake_lead + (NARROWBAND_CAUTION if band == "narrowband" else "") + SPOT_CHECK_ASIDE,
            "model_favors_real": f"The model's 'real' label won in {total - leaning} of {total} windows.",
            "inconclusive": "The model's scores were mixed or borderline, so no lean is reported.",
        }
        low, high = (s.voice_borderline_low, s.voice_borderline_high) if cutoff == 0.5 else (cutoff - s.voice_full_band_borderline, cutoff + s.voice_full_band_borderline)
        return VoiceAssessment(
            verdict=verdict,
            summary=summaries[verdict],
            fake_score_median=median,
            fake_score_max=round(max(scores), 4),
            windows_analyzed=len(results),
            windows_favoring_fake=leaning,
            windows=results,
            decision_rule=(
                f"A lean needs at least {s.voice_majority_ratio:.0%} of windows on the same side of {cutoff:g}, and a median "
                f"outside {low:g} to {high:g}."
                + (" The lower cut-off is used because the audio is full band; phone-quality audio uses 0.5." if cutoff != 0.5 else "")
                + " These cut-offs are fixed heuristics, not calibrated confidence levels, chosen on VoxShield's benchmark."
            ),
            audio_band=band,
            fake_cutoff=cutoff,
            reliability_caution=SPOT_CHECK,
            limitations=LIMITATIONS,
            model=self._model_info(),
        )


def build_voice_classifier(settings: Settings, band_matched: bool = True) -> HfAudioClassifier:
    """The voice-authenticity classifier the settings ask for. NII AntiDeepfake checkpoints need their own loader."""
    if settings.voice_model_id.startswith("nii-yamagishilab/"):
        from app.services.voice_nii import load_nii_detector

        return HfAudioClassifier(settings, loader=load_nii_detector, band_matched=band_matched)
    return HfAudioClassifier(settings, band_matched=band_matched and settings.voice_model_id == DEFAULT_VOICE_MODEL_ID)


def _detector_result(assessment: VoiceAssessment) -> VoiceDetectorResult:
    return VoiceDetectorResult(
        model=assessment.model,
        verdict=assessment.verdict,
        fake_score_median=assessment.fake_score_median,
        windows_analyzed=assessment.windows_analyzed,
        windows_favoring_fake=assessment.windows_favoring_fake,
        error=assessment.error,
    )


DETECTOR_NAMES = {"nii-yamagishilab": "NII AntiDeepfake", "Gustking": "the Gustking detector"}


def _short(model: ModelInfo | None) -> str:
    if not model:
        return "another detector"
    owner = model.name.split("/")[0]
    return DETECTOR_NAMES.get(owner, model.name)


class CombinedVoiceClassifier:
    """Runs several detectors on the same audio and reports one result.

    On full-band audio it leans "fake" when any detector does, and "real" only when every detector that ran does;
    anything else is inconclusive. The detectors miss different synthetic voices, and on full-band audio in VoxShield's
    benchmark the second detector never called a real voice fake. On phone or VoIP audio only the first detector
    counts: there the second one caught nothing extra and called 4 of 119 real voices fake over Opus. Every detector's
    own reading is kept in `detectors`, and the summary names the one that leaned "fake". If one detector fails, the
    others still answer."""

    def __init__(self, detectors: list[HfAudioClassifier]):
        self._detectors = detectors

    @property
    def loaded(self) -> bool:
        return all(d.loaded for d in self._detectors)

    @property
    def load_seconds(self) -> float | None:
        known = [d.load_seconds for d in self._detectors if d.load_seconds is not None]
        return round(sum(known), 2) if known else None

    @property
    def detectors(self) -> list[HfAudioClassifier]:
        return self._detectors

    def ensure_loaded(self) -> None:
        """Load every detector. One that fails to load does not stop the others; classify() reports it as unavailable."""
        errors: list[Exception] = []
        for detector in self._detectors:
            try:
                detector.ensure_loaded()
            except Exception as error:
                errors.append(error)
        if len(errors) == len(self._detectors):
            raise errors[0]

    def classify(self, audio: Audio16k) -> VoiceAssessment:
        results: list[VoiceAssessment] = []
        failures: list[tuple[HfAudioClassifier, ComponentFailure]] = []
        for detector in self._detectors:
            try:
                results.append(detector.classify(audio))
            except ComponentFailure as failure:
                failures.append((detector, failure))
        if not results:
            raise failures[0][1]
        readings = [_detector_result(r) for r in results] + [
            VoiceDetectorResult(model=d._model_info(), verdict="unavailable", error=f.message) for d, f in failures
        ]
        if len(readings) == 1:
            return results[0]

        primary = results[0]
        # Results come in detector order, so results[0] is the first detector's whenever it ran.
        full_band = primary.audio_band == "full_band"
        counted = results if full_band else results[:1]
        fakes = [r for r in counted if r.verdict == "model_favors_fake"]
        rule = (primary.decision_rule or "") + (
            " Two detectors run on every recording. On full-band audio the result leans 'fake' if either one does, and "
            "'real' only if both do. On phone or VoIP audio only the first detector decides, because the second added "
            "false alarms there in VoxShield's benchmark."
        )
        if fakes:
            chosen = fakes[0]
            others = [r for r in results if r is not chosen and r.verdict != "model_favors_fake"]
            lead = chosen.summary.removesuffix(SPOT_CHECK_ASIDE)
            if others:
                disagreement = " and ".join(f"{_short(r.model)} did not ({VERDICT_WORDS[r.verdict]})" for r in others)
                lead = f"Flagged by {_short(chosen.model)}: {lead[0].lower()}{lead[1:]} {disagreement[0].upper()}{disagreement[1:]}."
            summary = lead + SPOT_CHECK_ASIDE
            return chosen.model_copy(update={"summary": summary, "detectors": readings, "decision_rule": rule})
        if all(r.verdict == "model_favors_real" for r in counted):
            return primary.model_copy(update={"detectors": readings, "decision_rule": rule})
        if all(r.verdict == "inconclusive" for r in counted):
            return primary.model_copy(update={"detectors": readings, "decision_rule": rule})
        summary = "The detectors did not agree: " + "; ".join(f"{_short(r.model)} {VERDICT_WORDS[r.verdict]}" for r in counted) + ". No lean is reported."
        return primary.model_copy(update={"verdict": "inconclusive", "summary": summary, "detectors": readings, "decision_rule": rule})


VERDICT_WORDS = {"model_favors_fake": "leaned 'fake'", "model_favors_real": "leaned 'real'", "inconclusive": "was inconclusive", "unavailable": "did not run"}


def build_voice_service(settings: Settings) -> HfAudioClassifier | CombinedVoiceClassifier:
    """What the app runs: the default detector, plus the second detector unless it is switched off."""
    primary = build_voice_classifier(settings)
    if not settings.voice_secondary_model_id:
        return primary
    secondary_settings = settings.model_copy(
        update={"voice_model_id": settings.voice_secondary_model_id, "voice_model_revision": settings.voice_secondary_model_revision}
    )
    return CombinedVoiceClassifier([primary, build_voice_classifier(secondary_settings, band_matched=False)])

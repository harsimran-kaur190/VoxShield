import numpy as np
import pytest
import torch

from app.config import Settings
from app.services.interfaces import ComponentFailure
from app.services.voice_authenticity import HfAudioClassifier, LoadedClassifier, _label_index, decide, plan_windows

settings = Settings()


def tone(seconds: float, amplitude: float = 0.3) -> np.ndarray:
    t = np.arange(int(16000 * seconds)) / 16000
    return (np.sin(2 * np.pi * 220 * t) * amplitude).astype(np.float32)


class StubExtractor:
    def __call__(self, audio, sampling_rate, return_tensors):
        return {"input_values": torch.tensor(audio).unsqueeze(0)}


class StubModel:
    """Test double that returns fixed logits. It is a stand-in for wiring tests only, never a detector."""

    def __init__(self, fake_probability: float):
        p = fake_probability
        self.logits = torch.log(torch.tensor([[1 - p, p]]))

    def __call__(self, **inputs):
        return type("Out", (), {"logits": self.logits})()


def classifier_with(fake_probability: float) -> HfAudioClassifier:
    loaded = LoadedClassifier(StubExtractor(), StubModel(fake_probability), fake_index=1)
    return HfAudioClassifier(settings, loader=lambda s: loaded)


def test_label_mapping_is_read_by_name_not_position():
    assert _label_index({0: "real", 1: "fake"}, ("fake",)) == 1
    assert _label_index({0: "fake", 1: "real"}, ("fake",)) == 0
    assert _label_index({0: "a", 1: "b"}, ("fake",)) is None


def test_silent_audio_is_inconclusive_and_never_loads_the_model():
    def loader(_):
        raise AssertionError("model must not load for silent audio")

    result = HfAudioClassifier(settings, loader=loader).classify(np.zeros(16000 * 10, dtype=np.float32))
    assert result.verdict == "inconclusive"
    assert result.windows_analyzed == 0


def test_too_short_audio_is_inconclusive():
    assert classifier_with(0.9).classify(tone(2.5)).verdict == "inconclusive"


def test_high_fake_scores_lean_synthetic_with_real_window_scores():
    result = classifier_with(0.95).classify(tone(14))
    assert result.verdict == "model_favors_fake"
    assert result.windows_analyzed == len(result.windows) == 3
    assert all(w.fake_score == pytest.approx(0.95, abs=1e-3) for w in result.windows)
    assert result.windows_favoring_fake == 3


def test_low_fake_scores_lean_real_and_the_summary_reports_counts_not_certainty():
    result = classifier_with(0.05).classify(tone(14))
    assert result.verdict == "model_favors_real"
    assert f"{result.windows_analyzed} of {result.windows_analyzed} windows" in result.summary
    assert "genuine" not in result.summary and "safe" not in result.summary


def test_borderline_scores_are_inconclusive():
    assert classifier_with(0.52).classify(tone(14)).verdict == "inconclusive"


def test_scores_are_labelled_uncalibrated():
    result = classifier_with(0.9).classify(tone(8))
    assert "not a calibrated probability" in result.score_note
    assert "heuristics, not calibrated" in result.decision_rule


def test_model_load_failure_raises_a_safe_component_failure():
    def loader(_):
        raise OSError("secret path /home/someone/model")

    with pytest.raises(ComponentFailure) as info:
        HfAudioClassifier(settings, loader=loader).classify(tone(8))
    assert info.value.code == "model_load_failed"
    assert "secret path" not in info.value.message


def test_inference_failure_raises_component_failure():
    class Broken:
        def __call__(self, **_):
            raise RuntimeError("boom")

    loaded = LoadedClassifier(StubExtractor(), Broken(), fake_index=1)
    with pytest.raises(ComponentFailure) as info:
        HfAudioClassifier(settings, loader=lambda s: loaded).classify(tone(8))
    assert info.value.code == "inference_failed"


def test_plan_windows_skips_quiet_stretches_and_caps_count():
    audio = np.concatenate([tone(6), np.zeros(16000 * 6, dtype=np.float32), tone(6)])
    assert len(plan_windows(audio, settings)) == 2
    assert len(plan_windows(tone(300), settings)) == settings.voice_max_windows


def test_decide_requires_agreement():
    assert decide([0.9, 0.9, 0.1], settings) == "model_favors_fake"
    assert decide([0.9, 0.1], settings) == "inconclusive"
    assert decide([0.1, 0.2, 0.1], settings) == "model_favors_real"


def test_every_assessed_result_carries_the_visible_reliability_caution():
    for p in (0.05, 0.95, 0.5):
        result = classifier_with(p).classify(tone(14))
        assert "not an evaluation" in result.reliability_caution


def test_no_verdict_summary_claims_the_voice_is_genuine_or_the_call_fraudulent():
    for p in (0.05, 0.95, 0.5):
        text = classifier_with(p).classify(tone(14)).summary.lower()
        assert "is genuine" not in text
        assert "fraud" not in text and "scam" not in text

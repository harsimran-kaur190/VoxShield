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
        assert "not real calls" in result.reliability_caution


def test_no_verdict_summary_claims_the_voice_is_genuine_or_the_call_fraudulent():
    for p in (0.05, 0.95, 0.5):
        text = classifier_with(p).classify(tone(14)).summary.lower()
        assert "is genuine" not in text
        assert "fraud" not in text and "scam" not in text


def test_softly_recorded_speech_is_not_thrown_away_as_silence():
    # A quiet microphone: peak about 0.01. The model sees normalized windows, so the level must not decide anything.
    settings = Settings()
    rng = np.random.default_rng(0)
    quiet = (rng.standard_normal(16000 * 12) * 0.002).astype(np.float32)
    assert len(plan_windows(quiet, settings)) == 2
    assert plan_windows(quiet, settings) == plan_windows(quiet * 50, settings)  # the same windows at any recording level


def test_digital_silence_has_no_windows():
    assert plan_windows(np.zeros(16000 * 12, dtype=np.float32), Settings()) == []
    assert plan_windows(np.full(16000 * 12, 5e-5, dtype=np.float32), Settings()) == []


def test_nii_checkpoint_names_map_onto_the_transformers_wav2vec2_encoder():
    from transformers import Wav2Vec2Config, Wav2Vec2Model

    from app.services.voice_nii import map_encoder_weights

    config = Wav2Vec2Config(do_stable_layer_norm=True, feat_extract_norm="layer", conv_bias=True, num_hidden_layers=2,
                            hidden_size=32, intermediate_size=64, num_attention_heads=2, conv_dim=(8,) * 7, num_conv_pos_embedding_groups=2)
    target = Wav2Vec2Model(config).state_dict()
    fairseq = {}
    for i in range(7):
        fairseq[f"m_ssl.model.feature_extractor.conv_layers.{i}.0.weight"] = 0
        fairseq[f"m_ssl.model.feature_extractor.conv_layers.{i}.0.bias"] = 0
        fairseq[f"m_ssl.model.feature_extractor.conv_layers.{i}.2.1.weight"] = 0
        fairseq[f"m_ssl.model.feature_extractor.conv_layers.{i}.2.1.bias"] = 0
    for name in ("post_extract_proj.weight", "post_extract_proj.bias", "layer_norm.weight", "layer_norm.bias", "mask_emb",
                 "encoder.pos_conv.0.weight_g", "encoder.pos_conv.0.weight_v", "encoder.pos_conv.0.bias",
                 "encoder.layer_norm.weight", "encoder.layer_norm.bias", "quantizer.vars", "project_q.weight", "final_proj.bias"):
        fairseq[f"m_ssl.model.{name}"] = 0
    for i in range(2):
        for part in ("self_attn.q_proj", "self_attn.k_proj", "self_attn.v_proj", "self_attn.out_proj", "self_attn_layer_norm", "fc1", "fc2", "final_layer_norm"):
            fairseq[f"m_ssl.model.encoder.layers.{i}.{part}.weight"] = 0
            fairseq[f"m_ssl.model.encoder.layers.{i}.{part}.bias"] = 0
    fairseq["proj_fc.weight"] = fairseq["proj_fc.bias"] = 0
    assert set(map_encoder_weights(fairseq)) == set(target)  # every encoder weight, nothing extra, nothing missing


def test_the_nii_model_is_loaded_with_its_own_loader_and_its_fake_label_first():
    from app.services import voice_nii
    from app.services.voice_authenticity import build_voice_classifier

    classifier = build_voice_classifier(Settings())
    assert classifier._loader is voice_nii.load_nii_detector and voice_nii.FAKE_INDEX == 0
    other = build_voice_classifier(Settings(voice_model_id="Gustking/wav2vec2-large-xlsr-deepfake-audio-classification"))
    assert other._loader is not voice_nii.load_nii_detector


# ---- audio band, band-matched cut-off, and the two-detector combination ----

from app.services.voice_authenticity import (  # noqa: E402
    SPOT_CHECK_ASIDE,
    CombinedVoiceClassifier,
    audio_band,
    band_measurements,
    build_voice_service,
)


def bursts(seconds: float = 8, seed: int = 0) -> np.ndarray:
    """Full-band noise that rises and falls like speech, so the band above 4 kHz moves with the 'voice'."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(16000 * seconds)) / 16000
    envelope = (np.sin(2 * np.pi * 2 * t) > 0).astype(np.float32) + 0.01
    return (rng.standard_normal(len(t)) * envelope * 0.2).astype(np.float32)


def telephone(audio: np.ndarray, seed: int = 1) -> np.ndarray:
    """The same signal through a 300-3400 Hz channel, plus steady full-band noise, like a speakerphone recording."""
    spectrum = np.fft.rfft(audio)
    freqs = np.fft.rfftfreq(len(audio), 1 / 16000)
    spectrum[(freqs < 300) | (freqs > 3400)] = 0
    band = np.fft.irfft(spectrum, len(audio))
    noise = np.random.default_rng(seed).standard_normal(len(audio)) * np.sqrt(np.mean(band**2)) * 0.1
    return (band + noise).astype(np.float32)


def test_full_band_and_telephone_audio_are_told_apart_even_with_noise_in_the_high_band():
    full, phone = bursts(), telephone(bursts())
    assert audio_band(full, settings) == "full_band"
    assert audio_band(phone, settings) == "narrowband"
    assert band_measurements(full)["high_lift_db"] > 20 > band_measurements(phone)["high_lift_db"]
    assert audio_band(np.zeros(1000, dtype=np.float32), settings) == "unknown"


def test_the_lower_cut_off_changes_only_borderline_scores():
    scores = [0.35, 0.4, 0.36]
    assert decide(scores, settings) == "model_favors_real"
    assert decide(scores, settings, cutoff=0.2) == "model_favors_fake"
    assert decide([0.25, 0.2, 0.22], settings, cutoff=0.2) == "inconclusive"  # inside 0.1-0.3
    assert decide([0.01, 0.02, 0.01], settings, cutoff=0.2) == "model_favors_real"


def band_matched_with(fake_probability: float, model_id: str = "nii-yamagishilab/mms-300m-anti-deepfake") -> HfAudioClassifier:
    loaded = LoadedClassifier(StubExtractor(), StubModel(fake_probability), fake_index=1)
    return HfAudioClassifier(Settings(voice_model_id=model_id), loader=lambda s: loaded, band_matched=True)


def test_full_band_audio_uses_the_lower_cut_off_and_says_it_is_voxshields_not_the_models():
    result = band_matched_with(0.35).classify(bursts())
    assert (result.verdict, result.audio_band, result.fake_cutoff) == ("model_favors_fake", "full_band", 0.2)
    assert "the cut-off VoxShield uses for full-band audio" in result.summary
    assert "label won" not in result.summary.removesuffix(SPOT_CHECK_ASIDE)  # at 0.35 the model's own 'real' label won
    assert "full band" in result.decision_rule


def test_phone_quality_audio_keeps_the_0_5_rule_and_warns_about_false_alarms():
    assert band_matched_with(0.3).classify(telephone(bursts())).verdict == "model_favors_real"
    flagged = band_matched_with(0.9).classify(telephone(bursts()))
    assert (flagged.verdict, flagged.audio_band, flagged.fake_cutoff) == ("model_favors_fake", "narrowband", 0.5)
    assert "phone or VoIP audio" in flagged.summary and flagged.summary.endswith(SPOT_CHECK_ASIDE)


def test_other_detectors_never_get_the_lower_cut_off():
    assert classifier_with(0.3).classify(bursts()).fake_cutoff == 0.5


def detector(fake_probability: float, model_id: str) -> HfAudioClassifier:
    loaded = LoadedClassifier(StubExtractor(), StubModel(fake_probability), fake_index=1)
    return HfAudioClassifier(Settings(voice_model_id=model_id), loader=lambda s: loaded)


NII, GUST = "nii-yamagishilab/mms-300m-anti-deepfake", "Gustking/wav2vec2-large-xlsr-deepfake-audio-classification"


def test_combined_result_leans_fake_when_either_detector_does_and_names_it():
    result = CombinedVoiceClassifier([detector(0.01, NII), detector(0.9, GUST)]).classify(bursts())
    assert result.verdict == "model_favors_fake"
    assert result.summary.startswith("Flagged by the Gustking detector:")
    assert "NII AntiDeepfake did not (leaned 'real')" in result.summary
    assert result.summary.endswith(SPOT_CHECK_ASIDE)
    assert result.model.name == GUST  # the score and windows shown are the flagging detector's own
    assert [(d.model.name, d.verdict) for d in result.detectors] == [(NII, "model_favors_real"), (GUST, "model_favors_fake")]
    assert "either one does" in result.decision_rule


def test_combined_result_leans_real_only_when_both_do_and_is_inconclusive_when_they_disagree():
    assert CombinedVoiceClassifier([detector(0.01, NII), detector(0.02, GUST)]).classify(bursts()).verdict == "model_favors_real"
    mixed = CombinedVoiceClassifier([detector(0.01, NII), detector(0.5, GUST)]).classify(bursts())
    assert mixed.verdict == "inconclusive" and "did not agree" in mixed.summary


def test_on_phone_quality_audio_only_the_first_detector_decides_but_both_readings_are_shown():
    result = CombinedVoiceClassifier([detector(0.01, NII), detector(0.9, GUST)]).classify(telephone(bursts()))
    assert result.verdict == "model_favors_real"
    assert [(d.model.name, d.verdict) for d in result.detectors] == [(NII, "model_favors_real"), (GUST, "model_favors_fake")]
    assert "only the first detector decides" in result.decision_rule


def test_a_failing_second_detector_leaves_the_first_ones_answer_and_says_it_did_not_run():
    def broken(_settings):
        raise OSError("no weights")

    second = HfAudioClassifier(Settings(voice_model_id=GUST), loader=broken)
    result = CombinedVoiceClassifier([detector(0.01, NII), second]).classify(tone(8))
    assert result.verdict == "model_favors_real"
    assert [d.verdict for d in result.detectors] == ["model_favors_real", "unavailable"]
    assert result.detectors[1].error == "The voice authenticity model could not be loaded."


def test_combined_classifier_can_be_preloaded_and_one_failing_detector_does_not_stop_the_other():
    def broken(_settings):
        raise OSError("no weights")

    working = detector(0.01, NII)
    combined = CombinedVoiceClassifier([working, HfAudioClassifier(Settings(voice_model_id=GUST), loader=broken)])
    combined.ensure_loaded()  # the startup preload calls this; it must not raise while one detector still works
    assert working.loaded and not combined.loaded
    with pytest.raises(ComponentFailure):
        CombinedVoiceClassifier([HfAudioClassifier(Settings(voice_model_id=GUST), loader=broken)]).ensure_loaded()


def test_the_app_runs_both_detectors_by_default_with_the_second_pinned_and_can_switch_it_off():
    service = build_voice_service(Settings())
    assert isinstance(service, CombinedVoiceClassifier)
    first, second = service.detectors
    assert first._band_matched and not second._band_matched
    assert second._settings.voice_model_id == GUST
    assert second._settings.effective_voice_revision == "f7050b586236dc910d1157f430def2d0647b02b4"
    assert isinstance(build_voice_service(Settings(voice_secondary_model_id="")), HfAudioClassifier)

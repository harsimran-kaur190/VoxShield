"""Phase 3 unit tests: explainability of indicators, model loading, timings, and decode limits.

These are unit tests with stubbed models. They check wiring and rule logic only and say nothing about model accuracy.
"""

import threading
import time
from types import SimpleNamespace

import numpy as np
import pytest

from app.config import Settings
from app.schemas_analysis import TranscriptResult, TranscriptSegment
from app.services.audio_io import AudioDecodeError, load_mono_16k
from app.services.interfaces import ComponentFailure
from app.services.scam_intent import RuleBasedScamIntentAnalyzer
from app.services.transcription import FasterWhisperTranscriber
from app.services.voice_authenticity import HfAudioClassifier, LoadedClassifier
from tests.helpers import make_wav, transcript_of
from tests.test_voice_authenticity import StubExtractor, StubModel, tone

analyzer = RuleBasedScamIntentAnalyzer()


def two_segment_transcript() -> TranscriptResult:
    first, second = "Hello, thanks for picking up.", "Please read me the one time password we just sent you."
    return TranscriptResult(
        status="ok",
        text=f"{first} {second}",
        language="en",
        language_probability=0.99,
        segments=[
            TranscriptSegment(index=0, start_seconds=0.0, end_seconds=2.0, text=first, char_start=0, char_end=len(first)),
            TranscriptSegment(
                index=1, start_seconds=2.4, end_seconds=6.1, text=second, char_start=len(first) + 1, char_end=len(first) + 1 + len(second)
            ),
        ],
    )


# ---- indicator explainability -------------------------------------------------


def test_indicator_has_exact_excerpt_timestamp_reason_and_action():
    result = analyzer.analyze(two_segment_transcript())
    item = result.indicators[0]
    assert item.excerpt == "read me the one time password"
    assert item.excerpt in two_segment_transcript().text
    assert (item.start_seconds, item.end_seconds, item.segment_index) == (2.4, 6.1, 1)
    assert item.sentence.startswith("Please read me")
    assert item.rule_id in item.trigger and "No negation" in item.trigger
    assert item.explanation and item.suggested_action and item.context == "direct"


@pytest.mark.parametrize(
    "text",
    [
        "My grandmother got a call where the man said, read me your one time password, and she hung up on him luckily.",
        "He said you must transfer five hundred dollars right now or you will be arrested, and I told him to get lost.",
        'The email literally says "send me your password right now" and I deleted it without clicking on anything at all.',
        "Scammers often say don't tell your family and buy gift cards immediately. Here is how to spot those calls and stay safe.",
    ],
)
def test_quoted_or_recounted_requests_are_shown_but_do_not_raise_risk(text):
    result = analyzer.analyze(transcript_of(text))
    assert result.indicators and all(i.context == "reported" and i.severity == "low" for i in result.indicators)
    assert result.risk == "weak_signals" and result.categories == []
    assert result.reported_mentions == len(result.indicators)
    assert all("quoted or recounted" in i.trigger for i in result.indicators)


def test_the_same_request_made_directly_is_still_high():
    text = "This is the fraud department. Your account has been compromised, you must read me your PIN right now and stay on the line."
    result = analyzer.analyze(transcript_of(text))
    assert result.risk == "high" and all(i.context == "direct" for i in result.indicators)


@pytest.mark.parametrize(
    "text",
    [
        "I called the police yesterday to report my stolen bike and they were really helpful with the paperwork and the forms.",
        "My bank texted me a one time password and I used it to log in to the app without any problem at all today.",
        "The bank has a new branch near the station and the manager mentioned that the police station is next door to it.",
        "I went to the bank this morning to pay in some money and the cashier was quick, so I was home in good time for lunch.",
    ],
)
def test_mentioning_a_bank_otp_police_or_money_is_not_fraud(text):
    assert analyzer.analyze(transcript_of(text)).risk == "none_detected"


def test_asking_a_friend_for_money_is_only_a_weak_signal():
    text = "I need money for rent this month, can you lend me some, I will pay you back on Friday when I get paid, thanks."
    result = analyzer.analyze(transcript_of(text))
    assert result.risk == "weak_signals" and {i.severity for i in result.indicators} == {"low"}


def test_negated_advice_is_set_aside_and_counted():
    text = "Do not share your PIN with anyone. Our staff will never call you for it. This is a reminder from your bank branch today."
    result = analyzer.analyze(transcript_of(text))
    assert result.suppressed_mentions >= 1 and not [i for i in result.indicators if i.category == "credential_request"]


# ---- voice assessment semantics -------------------------------------------------


def test_voice_score_is_the_softmax_probability_of_the_fake_label_and_not_called_calibrated():
    loaded = LoadedClassifier(StubExtractor(), StubModel(0.8), fake_index=1)
    result = HfAudioClassifier(Settings(), loader=lambda s: loaded).classify(tone(14))
    assert all(w.fake_score == pytest.approx(0.8, abs=1e-3) for w in result.windows)
    assert "not a calibrated probability" in result.score_note and "not a probability of fraud" in result.score_note


def test_label_order_does_not_change_which_score_is_reported_as_fake():
    loaded = LoadedClassifier(StubExtractor(), StubModel(0.8), fake_index=0)  # labels swapped
    result = HfAudioClassifier(Settings(), loader=lambda s: loaded).classify(tone(14))
    assert all(w.fake_score == pytest.approx(0.2, abs=1e-3) for w in result.windows)


def test_inference_failure_is_a_safe_component_failure():
    class Broken:
        def __call__(self, **inputs):
            raise RuntimeError("tensor shapes secret")

    loaded = LoadedClassifier(StubExtractor(), Broken(), fake_index=1)
    with pytest.raises(ComponentFailure) as caught:
        HfAudioClassifier(Settings(), loader=lambda s: loaded).classify(tone(14))
    assert caught.value.code == "inference_failed" and "secret" not in caught.value.message


# ---- loading, concurrency, timings ----------------------------------------------


def test_models_load_once_even_when_many_threads_ask_at_the_same_time():
    calls = []

    def slow_factory(settings):
        calls.append(1)
        time.sleep(0.2)
        return SimpleNamespace(transcribe=lambda audio, **kw: (iter([]), SimpleNamespace(language="en", language_probability=1.0)))

    transcriber = FasterWhisperTranscriber(Settings(), model_factory=slow_factory)
    threads = [threading.Thread(target=transcriber.ensure_loaded) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(calls) == 1 and transcriber.loaded and transcriber.load_seconds >= 0.2


def test_voice_model_loads_once_under_concurrency():
    calls = []

    def loader(settings):
        calls.append(1)
        time.sleep(0.1)
        return LoadedClassifier(StubExtractor(), StubModel(0.1), fake_index=1)

    classifier = HfAudioClassifier(Settings(), loader=loader)
    threads = [threading.Thread(target=classifier.classify, args=(tone(8),)) for _ in range(5)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(calls) == 1


def test_failed_load_can_be_retried_and_never_reports_loaded():
    attempts = []

    def flaky(settings):
        attempts.append(1)
        if len(attempts) == 1:
            raise OSError("offline")
        return LoadedClassifier(StubExtractor(), StubModel(0.1), fake_index=1)

    classifier = HfAudioClassifier(Settings(), loader=flaky)
    with pytest.raises(ComponentFailure):
        classifier.ensure_loaded()
    assert not classifier.loaded
    classifier.ensure_loaded()
    assert classifier.loaded


def test_cold_request_reports_model_load_separately_and_warm_request_reports_none():
    from pathlib import Path
    import tempfile

    from app.schemas import AudioMetadata
    from app.services.pipeline import AnalysisPipeline

    def loader(settings):
        time.sleep(0.15)
        return LoadedClassifier(StubExtractor(), StubModel(0.1), fake_index=1)

    voice = HfAudioClassifier(Settings(), loader=loader)
    transcriber = SimpleNamespace(transcribe=lambda audio: transcript_of("A perfectly ordinary sentence about the weather today, nothing more."))
    pipeline = AnalysisPipeline(Settings(), transcriber, voice, analyzer)
    meta = AudioMetadata(filename="a.wav", format="wav", size_bytes=1, duration_seconds=6, sample_rate_hz=16000, channels=1)

    def run(path):
        return [e["report"] for e in pipeline.run(path, meta) if e["type"] == "report"][0]

    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "a.wav"
        path.write_bytes(make_wav(6, amplitude=0.2))
        cold, warm = run(path), run(path)
    assert cold.timings_seconds["model_load"] >= 0.15 and warm.timings_seconds["model_load"] == 0
    assert cold.timings_seconds["voice"] < cold.timings_seconds["model_load"] + 0.5
    assert cold.timings_seconds["total"] >= cold.timings_seconds["model_load"]


# ---- decode limits ---------------------------------------------------------------


def test_decoding_stops_when_audio_is_longer_than_allowed(tmp_path):
    path = tmp_path / "long.wav"
    path.write_bytes(make_wav(5, amplitude=0.2))
    assert len(load_mono_16k(path, max_seconds=10)) > 0
    with pytest.raises(AudioDecodeError):
        load_mono_16k(path, max_seconds=2)


def test_corrupt_audio_that_passes_the_header_check_fails_cleanly(tmp_path):
    path = tmp_path / "bad.wav"
    path.write_bytes(b"RIFF\x00\x00\x00\x00WAVEjunkjunkjunk")
    with pytest.raises(AudioDecodeError):
        load_mono_16k(path)

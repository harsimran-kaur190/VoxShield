"""Opt-in smoke test with the real models. Run: VOXSHIELD_RUN_REAL_MODELS=1 pytest tests/test_real_models.py"""

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

pytestmark = pytest.mark.skipif(
    os.environ.get("VOXSHIELD_RUN_REAL_MODELS") != "1", reason="set VOXSHIELD_RUN_REAL_MODELS=1 to run real inference"
)
SAMPLE = Path(__file__).parent / "fixtures" / "jfk.flac"


def test_real_speech_recording_goes_through_both_models():
    with TestClient(app) as client:
        response = client.post("/api/v1/analysis", files={"file": ("jfk.flac", SAMPLE.read_bytes(), "audio/flac")})
    report = response.json()
    assert response.status_code == 200 and report["status"] == "complete", report["errors"]
    assert "country" in report["transcript"]["text"].lower()
    assert report["transcript"]["language"] == "en"
    assert report["voice"]["windows_analyzed"] >= 1 and report["voice"]["fake_score_median"] is not None
    assert report["intent"]["risk"] in {"none_detected", "inconclusive"}


def _say(tmp_path, text, voice="Samantha"):
    import shutil
    import subprocess

    if not shutil.which("say") or not shutil.which("afconvert"):
        pytest.skip("needs macOS text-to-speech to make a labeled synthetic sample")
    if voice not in subprocess.run(["say", "-v", "?"], capture_output=True, text=True).stdout:
        pytest.skip(f"the macOS voice {voice!r} is not installed")
    aiff, wav = tmp_path / "tts.aiff", tmp_path / "tts.wav"
    subprocess.run(["say", "-v", voice, "-o", str(aiff), text], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16", str(aiff), str(wav)], check=True)
    return wav.read_bytes()


def test_synthetic_scam_script_is_transcribed_and_flagged_end_to_end(tmp_path):
    """Checks ASR + rules + schema on a known synthetic recording. The voice verdict is recorded, not asserted:
    this model is not reliable enough to assert on, and one clip proves nothing about accuracy."""
    text = "Please read me the one time password we just sent you. Do not tell anyone about this call, and do it right now."
    data = _say(tmp_path, text)
    with TestClient(app) as client:
        report = client.post("/api/v1/analysis", files={"file": ("tts.wav", data, "audio/wav")}).json()
    assert report["status"] == "complete", report["errors"]
    assert report["intent"]["risk"] in {"elevated", "high"}
    assert {"credential_request"} <= set(report["intent"]["categories"])
    assert all(i["start_seconds"] is not None for i in report["intent"]["indicators"])
    assert report["voice"]["verdict"] in {"model_favors_fake", "model_favors_real", "inconclusive"}


def _analyze_spoken(tmp_path, text):
    wav = _say(tmp_path, text)
    with TestClient(app) as client:
        response = client.post("/api/v1/analysis", files={"file": ("spoken.wav", wav, "audio/wav")})
    report = response.json()
    assert response.status_code == 200 and report["transcript"]["status"] == "ok", report.get("errors")
    return report


def _payment(report):
    return [i for i in report["intent"]["indicators"] if i["category"] == "payment_pressure" and i["context"] == "direct"]


def test_spoken_offer_to_send_money_is_transcribed_with_its_direction_and_not_flagged_as_a_request(tmp_path):
    """Speech goes through the real transcriber and the real classifier. The direction is checked in the transcript
    first, because the finding logic can only be as right as the words it is given."""
    report = _analyze_spoken(tmp_path, "Hello, thanks for waiting. Can I send you some money for now? Let me know what works for you.")
    assert "Can I send you some money" in report["transcript"]["text"]
    assert _payment(report) == []


def test_spoken_request_for_money_is_still_flagged(tmp_path):
    report = _analyze_spoken(tmp_path, "Hello, thanks for waiting. Could you send me some money for now? It is for my rent.")
    assert "Could you send me some money" in report["transcript"]["text"]
    assert _payment(report)


# ---- languages (real Whisper, real classifiers) ------------------------------------------------------------------------
# Hindi speech is made with the macOS "Lekha" voice (computer-generated, not a real caller). Punjabi is not supported:
# detected Punjabi speech gets a transcript and a "not validated" scam result (see test_languages.py).

import re  # noqa: E402

DEVANAGARI = re.compile(r"[\u0900-\u097F]")
HINDI_SPEECH = "नमस्ते, मैं आपके बैंक से बोल रहा हूँ। कृपया अपना वन टाइम पासवर्ड मुझे अभी बताइए।"
ENGLISH_SPEECH = "Hello, this is your bank. Please read me the one time code we just sent you, right now."


def _analyze_in(tmp_path, text, voice, language=None):
    wav = _say(tmp_path, text, voice)
    data = {} if language is None else {"language": language}
    with TestClient(app) as client:
        response = client.post("/api/v1/analysis", files={"file": ("spoken.wav", wav, "audio/wav")}, data=data)
    report = response.json()
    assert response.status_code == 200 and report["transcript"]["status"] == "ok", report.get("errors")
    return report


def test_english_without_a_language_is_detected_and_scam_detection_still_runs(tmp_path):
    report = _analyze_in(tmp_path, ENGLISH_SPEECH, "Samantha")
    lang = report["language"]
    assert (lang["requested"], lang["code"], lang["source"]) == ("auto", "en", "detected")
    assert 0 < lang["detection_score"] <= 1 and lang["scam_detection_supported"] is True
    assert report["intent"]["risk"] != "inconclusive" or report["intent"]["indicators"] == []


def test_spoken_hindi_is_detected_kept_in_hindi_and_checked_through_an_english_translation(tmp_path):
    report = _analyze_in(tmp_path, HINDI_SPEECH, "Lekha", "auto")
    lang = report["language"]
    assert (lang["code"], lang["source"]) == ("hi", "detected") and 0 < lang["detection_score"] <= 1
    assert DEVANAGARI.search(report["transcript"]["text"])  # the original script, not an English rendering
    assert (lang["scam_detection_supported"], lang["scam_detection_mode"]) == (True, "translated")
    translation = report["translation"]
    assert translation["status"] == "ok" and not DEVANAGARI.search(translation["text"])
    intent = report["intent"]
    assert intent["analyzed_text"] == "translation" and intent["risk"] in {"elevated", "high"}
    assert any(i["category"] == "credential_request" for i in intent["indicators"])  # "tell me your one time password"
    assert all(i["original_text"] for i in intent["indicators"] if i["text_source"] == "translation")
    assert report["voice"]["verdict"] != "unavailable"  # the voice assessment is separate and still runs


def test_selecting_hindi_returns_no_confidence_and_the_same_hindi_transcript(tmp_path):
    report = _analyze_in(tmp_path, HINDI_SPEECH, "Lekha", "hi")
    lang = report["language"]
    assert (lang["requested"], lang["code"], lang["source"], lang["detection_score"]) == ("hi", "hi", "selected", None)
    assert report["transcript"]["language_probability"] is None
    assert DEVANAGARI.search(report["transcript"]["text"]) and lang["mismatch"] is False
    assert lang["scam_detection_mode"] == "translated" and report["intent"]["risk"] in {"elevated", "high"}


def test_a_benign_hindi_sentence_gets_no_finding(tmp_path):
    report = _analyze_in(tmp_path, "नमस्ते, आज मौसम बहुत अच्छा है। मैं शाम को घर आऊँगा और हम साथ में खाना खाएँगे।", "Lekha", "hi")
    assert report["intent"]["risk"] in {"none_detected", "inconclusive"} and report["intent"]["indicators"] == []


def test_forcing_english_on_hindi_audio_is_caught_instead_of_trusting_an_english_rendering(tmp_path):
    """Whisper told "English" for Hindi speech produces English-looking text. Without the language check, the English
    scam detector would analyze words that were never said."""
    report = _analyze_in(tmp_path, HINDI_SPEECH, "Lekha", "en")
    lang = report["language"]
    assert lang["mismatch"] is True and lang["detected_code"] == "hi"
    assert lang["scam_detection_supported"] is False and report["intent"]["indicators"] == []
    assert report["translation"] is None  # a mismatch blocks the translation path too
    assert "You selected English" in report["intent"]["summary"]


def test_forcing_hindi_on_english_audio_is_caught_too(tmp_path):
    report = _analyze_in(tmp_path, ENGLISH_SPEECH, "Samantha", "hi")
    assert report["language"]["mismatch"] is True and report["language"]["detected_code"] == "en"
    assert report["intent"]["indicators"] == []

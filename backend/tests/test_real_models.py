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


def _say(tmp_path, text):
    import shutil
    import subprocess

    if not shutil.which("say") or not shutil.which("afconvert"):
        pytest.skip("needs macOS text-to-speech to make a labeled synthetic sample")
    aiff, wav = tmp_path / "tts.aiff", tmp_path / "tts.wav"
    subprocess.run(["say", "-v", "Samantha", "-o", str(aiff), text], check=True)
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

"""Opt-in live-call check with the REAL speech, scam and voice models over two real WebSocket participants (the WebRTC
media path itself is a browser matter and is covered by the manual two-computer test in docs/LIVE_CALL_TESTING.md).
Run: VOXSHIELD_RUN_REAL_MODELS=1 pytest tests/test_live_calls_real_models.py"""

import io
import os
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.calls import get_registry
from app.config import get_settings
from app.main import app
from tests.test_real_models import _say

pytestmark = pytest.mark.skipif(
    os.environ.get("VOXSHIELD_RUN_REAL_MODELS") != "1", reason="set VOXSHIELD_RUN_REAL_MODELS=1 to run real inference"
)
SCAM = "Please read me the one time password we just sent you. Do not tell anyone about this call, and do it right now."
HARMLESS = "Hello, I am calling to ask whether you would like to have lunch together on Saturday afternoon."


def pcm16k(wav_bytes: bytes) -> bytes:
    with wave.open(io.BytesIO(wav_bytes)) as w:
        rate, raw = w.getframerate(), w.readframes(w.getnframes())
        samples = np.frombuffer(raw, dtype="<i2").astype(np.float32)
        if w.getnchannels() > 1:
            samples = samples.reshape(-1, w.getnchannels()).mean(axis=1)
    if rate != 16000:
        samples = np.interp(np.arange(0, len(samples), rate / 16000), np.arange(len(samples)), samples)
    return np.clip(samples, -32768, 32767).astype("<i2").tobytes()


def join(ws):
    ws.send_json({"type": "join", "consent": True, "analyze": True, "language": "en"})
    welcome = ws.receive_json()
    assert welcome["type"] == "welcome"
    return welcome


def stream(ws, pcm: bytes, seconds_per_frame: float = 1.0):
    step = int(16000 * seconds_per_frame) * 2
    for i in range(0, len(pcm), step):
        ws.send_bytes(pcm[i : i + step])


def test_speech_received_by_one_participant_is_analysed_for_that_participant_only(tmp_path, monkeypatch):
    get_registry.cache_clear()
    monkeypatch.setattr(get_settings(), "call_max_ahead_seconds", 1000.0)  # faster than real time
    monkeypatch.setattr(get_settings(), "call_analysis_step_seconds", 3.0)
    scam = pcm16k(_say(tmp_path, SCAM)) + b"\x00" * 16000 * 2 * 6
    with TestClient(app) as client:
        room = client.post("/api/v1/calls").json()["room_id"]
        with client.websocket_connect(f"/api/v1/calls/{room}/ws") as alice, client.websocket_connect(f"/api/v1/calls/{room}/ws") as bob:
            alice_id = join(alice)["participant_id"]
            bob_id = join(bob)["participant_id"]
            assert alice.receive_json()["type"] == "peer-joined"
            # Alice's browser *receives* Bob's voice (Bob is the one speaking the scam) and sends it for analysis.
            stream(alice, scam)
            alerts, analyses = [], []
            heard = ""
            for _ in range(40):  # the transcript keeps a window's last sentence back until the next window confirms it
                message = alice.receive_json()
                if message["type"] == "analysis":
                    analyses.append(message)
                    heard = " ".join(line["text"] for a in analyses for line in a["transcript"]).lower()
                if message["type"] == "alert":
                    alerts.append(message["alert"])
                if alerts and "password" in heard:
                    break
            assert analyses and all(a["source_participant_id"] == bob_id for a in analyses)
            assert "password" in heard, heard
            assert alerts and alerts[0]["source_participant_id"] == bob_id != alice_id
            assert alerts[0]["kind"] == "scam" and alerts[0]["evidence"] and alerts[0]["voice"]["verdict"] in {"model_favors_fake", "model_favors_real", "inconclusive", "unavailable"}
            # Bob sent no audio, so he gets no transcript and no alert about anything.
            bob.send_json({"type": "ping"})
            seen = []
            while (message := bob.receive_json())["type"] != "pong":
                seen.append(message["type"])
            assert not {"analysis", "alert"} & set(seen), seen


def test_harmless_speech_is_transcribed_and_raises_no_scam_alert(tmp_path, monkeypatch):
    get_registry.cache_clear()
    monkeypatch.setattr(get_settings(), "call_max_ahead_seconds", 1000.0)
    monkeypatch.setattr(get_settings(), "call_analysis_step_seconds", 3.0)
    speech = pcm16k(_say(tmp_path, HARMLESS)) + b"\x00" * 16000 * 2 * 8
    with TestClient(app) as client:
        room = client.post("/api/v1/calls").json()["room_id"]
        with client.websocket_connect(f"/api/v1/calls/{room}/ws") as alice, client.websocket_connect(f"/api/v1/calls/{room}/ws") as bob:
            join(alice)
            join(bob)
            assert alice.receive_json()["type"] == "peer-joined"
            stream(alice, speech)
            heard, kinds = "", []
            for _ in range(40):
                message = alice.receive_json()
                kinds.append(message["type"])
                if message["type"] in ("analysis", "transcript"):
                    heard += " " + " ".join(line["text"] for line in message["transcript"]).lower()
                if message["type"] == "analysis-status" and message["state"] == "silence" and "lunch" in heard:
                    break
            assert "lunch" in heard, heard
            assert "alert" not in kinds, kinds

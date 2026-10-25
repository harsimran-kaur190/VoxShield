import io
import struct
import wave

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app

client = TestClient(app)
URL = "/api/v1/uploads/validate"


def make_wav(seconds: float = 2.0, rate: int = 8000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(struct.pack("<h", 0) * int(rate * seconds))
    return buffer.getvalue()


def post(name: str, data: bytes, mime: str = "audio/wav"):
    return client.post(URL, files={"file": (name, data, mime)})


def test_health():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_limits():
    body = client.get("/api/v1/limits").json()
    assert body["max_upload_mb"] == get_settings().max_upload_mb
    assert ".wav" in body["allowed_extensions"]


def test_valid_wav_returns_metadata_and_no_analysis():
    response = post("call.wav", make_wav(2.0))
    assert response.status_code == 200
    body = response.json()
    assert body["analysis_performed"] is False
    assert body["stored"] is False
    assert body["audio"]["format"] == "wav"
    assert body["audio"]["duration_seconds"] == pytest.approx(2.0, abs=0.05)


def test_rejects_bad_extension():
    response = post("notes.txt", b"hello", "text/plain")
    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "unsupported_extension"


def test_rejects_fake_audio_with_audio_extension():
    response = post("fake.wav", b"this is not audio at all, just text")
    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "unrecognized_audio"


def test_rejects_empty_file():
    response = post("empty.wav", b"")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "empty_file"


def test_rejects_corrupt_audio():
    response = post("broken.wav", b"RIFF\x00\x00\x00\x00WAVEjunkjunkjunk")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "unreadable_audio"


def test_rejects_too_short():
    response = post("short.wav", make_wav(0.3))
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "too_short"


def test_rejects_too_long(monkeypatch):
    monkeypatch.setattr(get_settings(), "max_duration_seconds", 1)
    response = post("long.wav", make_wav(3.0))
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "too_long"


def test_rejects_oversized_file(monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_mb", 0)
    response = post("big.wav", make_wav(1.5))
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "file_too_large"


def test_filename_is_sanitized():
    response = post("../../etc/pa<ss>wd.wav", make_wav(2.0))
    assert response.status_code == 200
    assert "/" not in response.json()["audio"]["filename"]
    assert "<" not in response.json()["audio"]["filename"]


def test_declared_oversized_body_is_rejected_before_it_is_read(monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_mb", 0)
    from app.main import create_app  # the size limit is read when the app starts, as in production

    response = TestClient(create_app()).post(URL, content=b"x" * (2 * 1024 * 1024), headers={"content-type": "multipart/form-data; boundary=x"})
    assert response.status_code == 413 and response.json()["detail"]["code"] == "file_too_large"


def test_cors_allows_only_the_configured_origins():
    ok = client.options(URL, headers={"origin": "http://localhost:5173", "access-control-request-method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options(URL, headers={"origin": "https://evil.example", "access-control-request-method": "POST"})
    assert "access-control-allow-origin" not in bad.headers


def test_stale_upload_folders_are_swept_but_fresh_and_unrelated_ones_are_kept():
    import os
    import tempfile
    import time
    from pathlib import Path

    from app.main import sweep_stale_uploads

    root = Path(tempfile.gettempdir())
    old, fresh, other = root / "voxshield-test-old", root / "voxshield-test-fresh", root / "unrelated-test-dir"
    for folder in (old, fresh, other):
        folder.mkdir(exist_ok=True)
    stamp = time.time() - 7200
    os.utime(old, (stamp, stamp))
    os.utime(other, (stamp, stamp))
    try:
        sweep_stale_uploads()
        assert not old.exists() and fresh.exists() and other.exists()
    finally:
        for folder in (old, fresh, other):
            if folder.exists():
                folder.rmdir()

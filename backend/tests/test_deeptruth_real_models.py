"""Opt-in smoke test with the real image models. Run: VOXSHIELD_RUN_REAL_MODELS=1 pytest tests/test_deeptruth_real_models.py

Downloads the two ViT classifiers (about 690 MB) and the MediaPipe face landmarker on first run."""

import io
import os

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

pytestmark = pytest.mark.skipif(os.environ.get("VOXSHIELD_RUN_REAL_MODELS") != "1", reason="set VOXSHIELD_RUN_REAL_MODELS=1 to run real inference")


def drawn_face() -> bytes:
    """A cartoon face MediaPipe recognises: skin ellipse, two eyes, a mouth. Not a benchmark, a plumbing check."""
    img = np.full((480, 640, 3), 200, np.uint8)
    cv2.ellipse(img, (320, 240), (120, 160), 0, 0, 360, (180, 150, 120), -1)
    cv2.circle(img, (270, 200), 15, (40, 30, 20), -1)
    cv2.circle(img, (370, 200), 15, (40, 30, 20), -1)
    cv2.ellipse(img, (320, 310), (40, 15), 0, 0, 360, (120, 40, 40), -1)
    buffer = io.BytesIO()
    Image.fromarray(img).save(buffer, "JPEG", quality=92)
    return buffer.getvalue()


def test_drawn_face_goes_through_landmarks_and_the_detector():
    with TestClient(app) as client:
        response = client.post("/api/v1/deeptruth/analyze", files={"file": ("face.jpg", drawn_face(), "image/jpeg")})
    assert response.status_code == 200, response.text
    report = response.json()
    module = report["modules"][0]
    assert module["status"] == "ok" and module["models"] == ["UnivFD (CLIP ViT-L/14 + linear probe)"]
    landmarks = next(e for e in module["evidence"] if e["label"] == "Face landmarks")["data"]
    assert landmarks["faces_found"] == 1 and landmarks["error"] is None
    reading = next(e for e in module["evidence"] if e["label"] == "Detector reading")["data"]
    assert reading["input"].startswith("whole image")
    detector = reading["detectors"][0]
    assert 0 < detector["fake_probability"] < 1 and 0 <= detector["raw_output"] <= 1


def cartoon_video(seconds: float = 8.0, fps: int = 25) -> bytes:
    """A drawn face whose mouth opens with bursts of noise on the audio track. Plumbing check, not a benchmark."""
    import tempfile
    from pathlib import Path

    import av

    rate = 16000
    rng = np.random.default_rng(0)
    bursts = (np.convolve(rng.random(int(seconds * fps)), np.ones(5) / 5, mode="same") > 0.5).astype(float)
    path = Path(tempfile.mkdtemp()) / "cartoon.mp4"
    with av.open(str(path), "w", format="mp4") as out:
        video = out.add_stream("mpeg4", rate=fps)
        video.width, video.height, video.pix_fmt, video.bit_rate = 640, 480, "yuv420p", 2_000_000
        audio = out.add_stream("aac", rate=rate)
        audio.layout = "mono"
        for i, level in enumerate(bursts):
            img = np.full((480, 640, 3), 200, np.uint8)
            cv2.ellipse(img, (320, 240), (120, 160), 0, 0, 360, (180, 150, 120), -1)
            cv2.circle(img, (270, 200), 15, (40, 30, 20), -1)
            cv2.circle(img, (370, 200), 15, (40, 30, 20), -1)
            cv2.ellipse(img, (320, 310), (40, 4 + int(26 * level)), 0, 0, 360, (120, 40, 40), -1)
            for packet in video.encode(av.VideoFrame.from_ndarray(img, format="rgb24")):
                out.mux(packet)
        gain = np.repeat(bursts, rate // fps)
        samples = (rng.normal(0, 0.2, len(gain)) * gain).astype(np.float32)[None]
        frame = av.AudioFrame.from_ndarray(samples, format="fltp", layout="mono")
        frame.sample_rate = rate
        for packet in audio.encode(frame):
            out.mux(packet)
        for packet in audio.encode():
            out.mux(packet)
        for packet in video.encode():
            out.mux(packet)
    return path.read_bytes()


def test_cartoon_video_goes_through_every_video_module():
    with TestClient(app) as client:
        response = client.post("/api/v1/deeptruth/analyze", files={"file": ("cartoon.mp4", cartoon_video(), "video/mp4")})
    assert response.status_code == 200, response.text
    report = response.json()
    modules = {m["modality"]: m for m in report["modules"]}
    assert set(modules) == {"video_frames", "video_temporal", "audio", "lipsync"}
    assert all(m["status"] == "ok" for m in modules.values()), [m["error"] for m in modules.values()]
    assert modules["video_frames"]["models"] == ["UnivFD (CLIP ViT-L/14 + linear probe)"]
    sync = next(e["data"] for e in modules["lipsync"]["evidence"] if e["type"] == "metadata")
    assert sync["best_correlation"] > 0.5 and abs(sync["best_lag_seconds"]) <= 0.2  # mouth drawn from the same bursts

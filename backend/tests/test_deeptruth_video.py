"""Phase 4: the video pipeline. Models are faked, but frame decoding, audio extraction, the face track, the
consistency check and the sync correlation are the real code.

Trick used throughout: generated videos are plain grey frames whose brightness encodes how open the mouth is, and the
fake face finder reads that brightness back. So the audio envelope can be made to match (or lag) the mouth exactly."""

import tempfile
from pathlib import Path

import av
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.deeptruth import get_image_components, get_voice
from app.config import get_settings
from app.deeptruth.dependencies import ImageComponents
from app.deeptruth.modules.face_analysis import face_from_landmarks
from app.deeptruth.modules.lipsync import lagged_correlation, sync_score
from app.deeptruth.modules.video_temporal import RIGID_POINTS, build_temporal_module, procrustes_residual
from app.deeptruth.preprocess.frames import iter_frames
from app.deeptruth.schemas import DeepTruthReport
from app.main import app, create_app
from app.schemas_analysis import ModelInfo, VoiceAssessment, VoiceWindow
from tests.helpers import FakeVoice

client = TestClient(app)
URL = "/api/v1/deeptruth/analyze"
RATE = 16000


def envelope(seconds: float, seed: int = 0) -> np.ndarray:
    """A smooth 0-1 'syllable' signal sampled at 100 Hz: speech-like bursts of 0.1-0.4 s."""
    rng = np.random.default_rng(seed)
    raw = rng.random(int(seconds * 100) + 1)
    kernel = np.hanning(25)
    smooth = np.convolve(raw, kernel / kernel.sum(), mode="same")
    smooth = (smooth - smooth.min()) / (np.ptp(smooth) or 1)
    return (smooth > 0.5).astype(float) * smooth


def make_video(seconds=10.0, fps=25, audio_lag=0.0, with_audio=True, glitch_at: float | None = None) -> bytes:
    env = envelope(seconds)
    path = Path(tempfile.mkdtemp()) / "v.mp4"
    with av.open(str(path), "w", format="mp4") as out:
        video = out.add_stream("mpeg4", rate=fps)
        video.width, video.height, video.pix_fmt = 160, 120, "yuv420p"
        video.bit_rate = 2_000_000
        audio = None
        if with_audio:
            audio = out.add_stream("aac", rate=RATE)
            audio.layout = "mono"
        for i in range(int(seconds * fps)):
            t = i / fps
            level = 30 + 200 * env[min(int(t * 100), len(env) - 1)]
            if glitch_at is not None and abs(t - glitch_at) < 0.5 / fps:
                level = 255  # the fake face finder turns a 255 frame into a distorted face
            frame = av.VideoFrame.from_ndarray(np.full((120, 160, 3), level, np.uint8), format="rgb24")
            for packet in video.encode(frame):
                out.mux(packet)
        if audio is not None:
            n = int(seconds * RATE)
            times = np.arange(n) / RATE - audio_lag  # the sound at time t follows the mouth at t - lag
            gain = np.interp(times, np.arange(len(env)) / 100, env, left=0, right=0)
            samples = (np.random.default_rng(1).normal(0, 0.3, n) * gain).astype(np.float32)[None]
            frame = av.AudioFrame.from_ndarray(samples, format="fltp", layout="mono")
            frame.sample_rate = RATE
            for packet in audio.encode(frame):
                out.mux(packet)
            for packet in audio.encode():
                out.mux(packet)
        for packet in video.encode():
            out.mux(packet)
    return path.read_bytes()


def face_with_mouth(gap: float, distort: bool = False):
    """A face whose inner lips are `gap` of the face height apart. distort=True bends the rigid points."""
    rng = np.random.default_rng(7)
    points = np.column_stack([rng.uniform(0.3, 0.7, 478), rng.uniform(0.2, 0.7, 478)]).astype(np.float32)
    points[10], points[152] = (0.5, 0.2), (0.5, 0.7)  # forehead, chin: face height 0.5
    points[13], points[14] = (0.5, 0.55), (0.5, 0.55 + gap * 0.5)
    if distort:
        points[RIGID_POINTS[:6]] += 0.08
    return face_from_landmarks(points)


class BrightnessFaces:
    """Fake face finder: mouth openness from frame brightness; a white frame is a glitched face; black = no face."""

    def detect(self, rgb):
        level = float(rgb.mean())
        if level < 10:
            return []
        return [face_with_mouth(max(level - 30, 0) / 200 * 0.12, distort=level > 245)]


class ConstantClassifier:
    name = "fake/frame-model"

    def fake_probability(self, image):
        return 0.3


def voice_reading() -> VoiceAssessment:
    return VoiceAssessment(
        verdict="model_favors_real", summary="test", fake_score_median=0.05, fake_score_max=0.1, windows_analyzed=2,
        windows_favoring_fake=0, windows=[VoiceWindow(start_seconds=0, end_seconds=5, fake_score=0.05), VoiceWindow(start_seconds=5, end_seconds=10, fake_score=0.05)],
        audio_band="full_band", fake_cutoff=0.2, model=ModelInfo(name="test-voice", method="test"),
    )


@pytest.fixture(autouse=True)
def fakes():
    app.dependency_overrides[get_image_components] = lambda: ImageComponents([ConstantClassifier()], BrightnessFaces())
    app.dependency_overrides[get_voice] = lambda: FakeVoice(voice_reading())
    yield
    app.dependency_overrides.clear()


def analyze(data: bytes) -> DeepTruthReport:
    response = client.post(URL, files={"file": ("clip.mp4", data, "video/mp4")})
    assert response.status_code == 200, response.text
    return DeepTruthReport.model_validate(response.json())


def module(report, modality):
    return next(m for m in report.modules if m.modality == modality)


def metadata(mod, label):
    return next(e.data for e in mod.evidence if e.label == label)


# ---- building blocks ------------------------------------------------------------------------------------------------

def test_lagged_correlation_finds_the_shift():
    rng = np.random.default_rng(3)
    mouth = np.convolve(rng.random(200), np.ones(4) / 4, mode="same")
    energy = np.roll(mouth, 3)  # sound 3 samples after the mouth
    best = max(lagged_correlation(mouth, energy, 5), key=lambda x: x[1])
    assert best[0] == 3 and best[1] > 0.95
    mouth[::7] = np.nan  # frames without a face are skipped, not treated as closed mouths
    assert max(lagged_correlation(mouth, energy, 5), key=lambda x: x[1])[0] == 3


def test_sync_score_mapping():
    assert sync_score(0.6, 0.0) == 0.25
    assert sync_score(0.0, 0.0) == 0.7
    assert 0.25 < sync_score(0.2, 0.0) < 0.7
    assert sync_score(0.6, 0.4) == 0.6  # in step would be 0.25; out of step raises it


def test_procrustes_ignores_head_motion_but_sees_shape_change():
    points = np.random.default_rng(0).random((18, 2)) * 100
    angle = 0.3
    rotation = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    moved = points @ rotation.T * 1.4 + 25  # turned, zoomed, shifted: same shape
    assert procrustes_residual(points, moved) < 1e-6
    bent = points.copy()
    bent[:4] += 15
    assert procrustes_residual(points, bent) > 0.05


def test_temporal_module_flags_a_single_frame_glitch_and_needs_enough_frames():
    steady = [(i / 10, face_with_mouth(0.02 + 0.001 * (i % 3))) for i in range(60)]
    glitched = list(steady)
    glitched[30] = (3.0, face_with_mouth(0.02, distort=True))
    clean = build_temporal_module(steady, 0.1, 640, 480)
    bad = build_temporal_module(glitched, 0.1, 640, 480)
    assert clean.status == "ok" and bad.score > clean.score
    assert metadata(bad, "Consistency measurements")["shape_glitches"] >= 1
    assert bad.reliability <= 0.3
    assert build_temporal_module(steady[:5], 0.1, 640, 480).status == "unavailable"


def test_frames_are_sampled_at_the_requested_rate(tmp_path):
    path = tmp_path / "upload.bin"
    path.write_bytes(make_video(seconds=3, with_audio=False))
    times = [t for t, _ in iter_frames(path, 10, 60, 960)]
    assert 28 <= len(times) <= 31
    assert np.allclose(np.diff(times), 0.1, atol=0.021)
    assert len([t for t, _ in iter_frames(path, 10, 1.0, 960)]) <= 11  # max_seconds stops early


# ---- end to end -----------------------------------------------------------------------------------------------------

def test_video_with_matching_audio_runs_four_modules_and_finds_sync():
    report = analyze(make_video(audio_lag=0.0))
    assert report.media.kind == "video" and report.status == "complete"
    assert [m.modality for m in report.modules] == ["video_frames", "video_temporal", "audio", "lipsync"]
    sync = metadata(module(report, "lipsync"), "Sync measurements")
    assert sync["best_correlation"] > 0.6 and abs(sync["best_lag_seconds"]) <= 0.1
    assert module(report, "lipsync").score == 0.25
    frames = module(report, "video_frames")
    assert frames.score == pytest.approx(0.3) and metadata(frames, "Frame sampling")["frames_scored"] == 16
    assert report.verdict == "No manipulation detected"
    assert set(report.timings_seconds) >= {"frames", "audio_decode", "audio", "total"}


def test_shifted_audio_is_reported_as_out_of_step():
    report = analyze(make_video(audio_lag=0.4))
    lipsync = module(report, "lipsync")
    assert metadata(lipsync, "Sync measurements")["best_lag_seconds"] == pytest.approx(0.4, abs=0.1)
    assert lipsync.score >= 0.6 and "out of step" in lipsync.summary


def test_silent_video_skips_voice_and_sync_and_says_so():
    report = analyze(make_video(with_audio=False))
    assert [m.modality for m in report.modules] == ["video_frames", "video_temporal"]
    assert any("no audio track" in item for item in report.limitations)


def test_long_videos_are_truncated_for_frames_and_the_report_says_so(monkeypatch):
    monkeypatch.setattr(get_settings(), "video_max_analyzed_seconds", 4)
    report = analyze(make_video(seconds=8))
    assert report.limitations[0].startswith("Only the first 4 s of this 8")
    assert max(w["start_seconds"] for w in next(e.data for e in module(report, "video_frames").evidence if e.type == "timeline")["windows"]) < 4


def test_glitched_frame_shows_up_in_the_consistency_check():
    report = analyze(make_video(glitch_at=5.0))
    temporal = module(report, "video_temporal")
    assert metadata(temporal, "Consistency measurements")["shape_glitches"] >= 1
    flagged = [w for w in next(e.data for e in temporal.evidence if e.type == "timeline")["windows"] if w["flagged"]]
    assert any(4.7 <= w["start_seconds"] <= 5.1 for w in flagged)


def test_deeptruth_accepts_files_larger_than_the_voxshield_audio_limit(monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_mb", 0)  # the audio route now refuses everything over 1 MB of overhead
    big = TestClient(create_app())
    body = b"x" * (2 * 1024 * 1024)
    headers = {"content-type": "multipart/form-data; boundary=x"}
    assert big.post("/api/v1/analysis", content=body, headers=headers).status_code == 413
    assert big.post(URL, content=body, headers=headers).status_code != 413

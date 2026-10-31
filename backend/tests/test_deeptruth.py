"""Phase 1 of DeepTruth: media-type routing, the common module format, and the audio module built on VoxShield's
voice detector. Models are replaced by fakes, so these tests run in a second and need no download."""

import io
import os
import tempfile
from pathlib import Path

import av
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.deeptruth import get_voice
from app.config import get_settings
from app.deeptruth.fusion.fuse import fuse, verdict_for
from app.deeptruth.modules.audio_analysis import analyze_audio, rescale
from app.deeptruth.preprocess.detect_type import detect_media, sniff_container, sniff_image
from app.deeptruth.schemas import DeepTruthReport, MediaInfo, ModuleResult
from app.errors import UploadError
from app.main import app
from app.schemas_analysis import ModelInfo, VoiceAssessment, VoiceWindow
from tests.helpers import FAIL, FakeVoice, make_wav

client = TestClient(app)
URL = "/api/v1/deeptruth/analyze"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def make_mp4(seconds: float = 1.0, with_audio: bool = False) -> bytes:
    """A tiny real MP4 made with PyAV, so the detector sees genuine streams."""
    path = Path(tempfile.mkdtemp()) / "t.mp4"
    with av.open(str(path), "w") as out:
        video = out.add_stream("mpeg4", rate=10)
        video.width, video.height, video.pix_fmt = 64, 48, "yuv420p"
        audio = None
        if with_audio:
            audio = out.add_stream("aac", rate=16000)
            audio.layout = "mono"
        for i in range(int(seconds * 10)):
            frame = av.VideoFrame.from_ndarray(np.full((48, 64, 3), i * 20 % 255, np.uint8), format="rgb24")
            for packet in video.encode(frame):
                out.mux(packet)
        if audio is not None:
            samples = np.zeros((1, 16000 * int(seconds)), dtype=np.float32)
            frame = av.AudioFrame.from_ndarray(samples, format="fltp", layout="mono")
            frame.sample_rate = 16000
            for packet in audio.encode(frame):
                out.mux(packet)
            for packet in audio.encode():
                out.mux(packet)
        for packet in video.encode():
            out.mux(packet)
    data = path.read_bytes()
    os.remove(path)
    return data


def media_of(data: bytes, name: str) -> MediaInfo:
    path = Path(tempfile.mkdtemp()) / "upload.bin"
    path.write_bytes(data)
    try:
        return detect_media(path, name, len(data))
    finally:
        os.remove(path)


def post(name: str, data: bytes):
    return client.post(URL, files={"file": (name, data, "application/octet-stream")})


@pytest.fixture(autouse=True)
def reset_overrides():
    yield
    app.dependency_overrides.clear()


def use_voice(voice) -> None:
    app.dependency_overrides[get_voice] = lambda: voice


def assessment(median: float, windows: list[float], band: str = "full_band", cutoff: float = 0.2, verdict: str = "model_favors_fake") -> VoiceAssessment:
    return VoiceAssessment(
        verdict=verdict,
        summary="fake reading for a test",
        fake_score_median=median,
        fake_score_max=max(windows),
        windows_analyzed=len(windows),
        windows_favoring_fake=sum(w >= cutoff for w in windows),
        windows=[VoiceWindow(start_seconds=i * 6, end_seconds=i * 6 + 6, fake_score=w) for i, w in enumerate(windows)],
        audio_band=band,
        fake_cutoff=cutoff,
        model=ModelInfo(name="test-voice-model", method="test"),
    )


# ---- type detection -------------------------------------------------------------------------------------------------

def test_magic_bytes_identify_images_and_containers():
    assert sniff_image(b"\xff\xd8\xff\xe0" + b"\x00" * 28) == "jpeg"
    assert sniff_image(PNG[:32]) == "png"
    assert sniff_image(b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 16) == "webp"
    assert sniff_container(b"RIFF\x00\x00\x00\x00AVI LIST" + b"\x00" * 16) == "avi"
    assert sniff_container(b"\x1a\x45\xdf\xa3" + b"\x00" * 28) == "matroska"
    assert sniff_container(b"\x00\x00\x00\x18ftypisom" + b"\x00" * 20) == "mp4"
    assert sniff_container(b"\x00\x00\x00\x18ftypM4A " + b"\x00" * 20) == "m4a"


def test_detects_image_audio_and_video_from_bytes_not_extension():
    assert media_of(PNG, "photo.jpg").kind == "image"  # wrong extension, right answer
    wav = media_of(make_wav(2.0), "clip.mp4")
    assert wav.kind == "audio" and wav.format == "wav" and wav.duration_seconds == pytest.approx(2.0, abs=0.1)
    video = media_of(make_mp4(1.0), "clip.wav")
    assert video.kind == "video" and video.width == 64 and video.has_audio is False
    assert media_of(make_mp4(1.0, with_audio=True), "clip.mp4").has_audio is True


def test_unrecognized_bytes_are_rejected():
    with pytest.raises(UploadError) as error:
        media_of(b"just some text, not media", "x.png")
    assert error.value.detail["code"] == "unrecognized_media"


# ---- audio module ---------------------------------------------------------------------------------------------------

def test_rescale_puts_the_detector_cutoff_at_one_half():
    assert rescale(0.2, 0.2) == 0.5
    assert rescale(0.1, 0.2) == pytest.approx(0.25)
    assert rescale(0.6, 0.2) == pytest.approx(0.75)
    assert rescale(0.5, 0.5) == 0.5 and rescale(1.0, 0.2) == 1.0 and rescale(0.0, 0.2) == 0.0


def test_audio_module_wraps_voice_result_in_common_format():
    media = MediaInfo(filename="a.wav", kind="audio", format="wav", size_bytes=10, duration_seconds=12)
    result = analyze_audio(np.zeros(16000 * 12, np.float32), FakeVoice(assessment(0.6, [0.1, 0.7])), media)
    assert result.modality == "audio" and result.status == "ok"
    assert result.score == pytest.approx(0.75)
    assert 0.5 <= result.reliability <= 0.8
    types = [e.type for e in result.evidence]
    assert types == ["timeline", "spectrogram", "metadata"]
    timeline = result.evidence[0].data
    assert [w["flagged"] for w in timeline["windows"]] == [False, True]
    spec = result.evidence[1].data
    assert len(spec["values"]) <= 240 and len(spec["values"][0]) == 64 and spec["freq_max_hz"] == 8000
    assert result.models == ["test-voice-model"]


def test_audio_module_lowers_reliability_for_phone_quality_and_short_clips():
    media = MediaInfo(filename="a.wav", kind="audio", format="wav", size_bytes=10, duration_seconds=3)
    result = analyze_audio(np.zeros(16000 * 3, np.float32), FakeVoice(assessment(0.3, [0.3], band="narrowband")), media)
    assert result.reliability < 0.3
    assert any("Phone or VoIP" in item for item in result.limitations)
    assert any("3 s long" in item for item in result.limitations)


def test_audio_module_failure_is_unavailable_not_a_guess():
    media = MediaInfo(filename="a.wav", kind="audio", format="wav", size_bytes=10, duration_seconds=5)
    result = analyze_audio(np.zeros(16000 * 5, np.float32), FakeVoice(error=FAIL), media)
    assert result.status == "unavailable" and result.reliability == 0 and result.score == 0.5
    assert result.error == FAIL.message
    assert [e.type for e in result.evidence] == ["spectrogram"]


# ---- fusion (phase 1 version) -----------------------------------------------------------------------------------------

def test_verdict_bands():
    assert verdict_for(0.8, 0.7) == "Likely manipulated"
    assert verdict_for(0.2, 0.7) == "No manipulation detected"
    assert verdict_for(0.5, 0.7) == "Inconclusive"
    assert verdict_for(0.9, 0.1) == "Inconclusive"  # too little reliability to call it


def test_fuse_ignores_unavailable_modules_and_reports_partial_status():
    media = MediaInfo(filename="a.wav", kind="audio", format="wav", size_bytes=10)
    ok = ModuleResult(modality="audio", score=0.9, reliability=0.8, limitations=["a"])
    down = ModuleResult(modality="image", score=0.5, reliability=0.0, status="unavailable", limitations=["a", "b"])
    report = fuse([ok, down], media)
    assert report.verdict == "Likely manipulated" and report.manipulation_likelihood == 0.9
    assert report.status == "partial" and report.confidence == 0.8
    assert report.limitations[0].startswith("The image module did not run") and report.limitations[1:] == ["a", "b"]
    assert fuse([down], media).verdict == "Inconclusive"


# ---- endpoint ---------------------------------------------------------------------------------------------------------

def test_endpoint_runs_audio_pipeline_and_returns_report():
    use_voice(FakeVoice(assessment(0.7, [0.6, 0.8])))
    response = post("voice.wav", make_wav(12, amplitude=0.2))
    assert response.status_code == 200, response.text
    report = DeepTruthReport.model_validate(response.json())
    assert report.media.kind == "audio" and report.verdict == "Likely manipulated"
    assert [m.modality for m in report.modules] == ["audio"]
    assert set(report.timings_seconds) == {"decode", "audio", "total"}


def test_endpoint_rejects_unknown_extension_and_garbage_bytes():
    assert post("notes.txt", b"hello").status_code == 415
    bad = post("x.wav", b"this is not media")
    assert bad.status_code == 415 and bad.json()["detail"]["code"] == "unrecognized_media"


def test_endpoint_cleans_up_temp_dir_and_survives_detector_failure():
    use_voice(FakeVoice(error=FAIL))
    before = {p.name for p in Path(tempfile.gettempdir()).glob("voxshield-*")}
    response = post("voice.wav", make_wav(6, amplitude=0.2))
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "failed" and body["verdict"] == "Inconclusive"
    assert {p.name for p in Path(tempfile.gettempdir()).glob("voxshield-*")} == before


def test_limits_lists_extensions_per_kind():
    body = client.get("/api/v1/deeptruth/limits").json()
    assert ".png" in body["extensions"]["image"] and ".mp4" in body["extensions"]["video"] and ".wav" in body["extensions"]["audio"]
    assert body["supported_kinds"] == ["audio", "image", "video"]
    assert body["max_upload_mb"] == get_settings().deeptruth_max_upload_mb

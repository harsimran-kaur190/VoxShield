"""Phase 2: the image module. Classifiers and the face finder are faked; images are drawn with Pillow."""

import io
import tempfile
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api.deeptruth import get_image_components
from app.deeptruth.dependencies import ImageComponents
from app.deeptruth.modules import image_forensics as forensics
from app.deeptruth.modules.face_analysis import Face, crop_face, face_from_landmarks
from app.deeptruth.modules.image_analysis import analyze_image
from app.deeptruth.schemas import DeepTruthReport, MediaInfo
from app.main import app
from app.services.interfaces import ComponentFailure

client = TestClient(app)
URL = "/api/v1/deeptruth/analyze"


def photo(width=640, height=480, fmt="JPEG", quality=92, exif: dict | None = None, noise=True) -> bytes:
    """A noisy gradient 'photo'. With exif={...} the given tags (by name) are written."""
    rng = np.random.default_rng(0)
    base = np.linspace(40, 220, width, dtype=np.float32)[None, :, None].repeat(height, 0).repeat(3, 2)
    if noise:
        base = base + rng.normal(0, 6, base.shape)
    image = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    buffer = io.BytesIO()
    kwargs = {}
    if exif:
        from PIL.ExifTags import Base

        data = Image.Exif()
        for name, value in exif.items():
            data[getattr(Base, name).value] = value
        kwargs["exif"] = data.tobytes()
    if fmt == "JPEG":
        kwargs["quality"] = quality
    image.save(buffer, fmt, **kwargs)
    return buffer.getvalue()


def spliced(width=640, height=480) -> bytes:
    """A photo with a block pasted in at a different JPEG quality and with no noise: what ELA and noise maps look for."""
    first = Image.open(io.BytesIO(photo(width, height, quality=95)))
    patch = Image.open(io.BytesIO(photo(160, 120, quality=40, noise=False)))
    first.paste(patch, (240, 180))
    buffer = io.BytesIO()
    first.save(buffer, "JPEG", quality=95)
    return buffer.getvalue()


def save(data: bytes) -> Path:
    path = Path(tempfile.mkdtemp()) / "upload.bin"
    path.write_bytes(data)
    return path


def fake_face(x=0.3, y=0.2, w=0.4, h=0.5) -> Face:
    """478 landmarks spread over a box, with the named points placed where a face would have them."""
    points = np.column_stack([np.random.default_rng(1).uniform(x, x + w, 478), np.random.default_rng(2).uniform(y, y + h, 478)]).astype(np.float32)
    points[33], points[263] = (x + 0.2 * w, y + 0.35 * h), (x + 0.8 * w, y + 0.35 * h)  # eyes
    points[10], points[152] = (x + 0.5 * w, y), (x + 0.5 * w, y + h)  # forehead, chin
    points[13], points[14] = (x + 0.5 * w, y + 0.7 * h), (x + 0.5 * w, y + 0.74 * h)  # inner lips
    for left, right in ((362, 133), (386, 159), (374, 145), (291, 61), (454, 234), (323, 93), (397, 172), (288, 58)):
        points[left], points[right] = (x + 0.7 * w, y + 0.5 * h), (x + 0.3 * w, y + 0.5 * h)
    return face_from_landmarks(points)


class FakeFaces:
    def __init__(self, faces=None, error=None):
        self.faces, self.error, self.calls = faces or [], error, 0

    def detect(self, rgb):
        self.calls += 1
        if self.error:
            raise self.error
        return self.faces


class FakeClassifier:
    def __init__(self, name, probability=None, error=None):
        self.name, self.probability, self.error = name, probability, error
        self.seen = []

    def fake_probability(self, image):
        self.seen.append(image.size)
        if self.error:
            raise self.error
        return self.probability


def media(name="p.jpg") -> MediaInfo:
    return MediaInfo(filename=name, kind="image", format="jpeg", size_bytes=1000)


@pytest.fixture(autouse=True)
def reset_overrides():
    yield
    app.dependency_overrides.clear()


# ---- forensics ---------------------------------------------------------------------------------------------------------

def test_ela_and_noise_maps_light_up_on_a_spliced_region():
    rgb, _, _ = forensics.load_rgb(save(spliced()), 1600)
    ela_map, ela_stats = forensics.error_level_analysis(rgb)
    noise_map, noise_stats = forensics.noise_inconsistency(rgb)
    plain_rgb, _, _ = forensics.load_rgb(save(photo()), 1600)
    _, plain_ela = forensics.error_level_analysis(plain_rgb)
    _, plain_noise = forensics.noise_inconsistency(plain_rgb)
    assert len(ela_map) == 72 and len(ela_map[0]) == 96  # 640x480 shrunk to a 96-wide grid
    assert noise_stats["variation"] > plain_noise["variation"]  # the pasted block has no noise
    assert ela_stats["hot_block_fraction"] >= plain_ela["hot_block_fraction"]
    # The pasted block sits at (240..400, 180..300) in a 640x480 image: rows 27..45, cols 36..60 of the noise grid.
    grid = np.array(noise_map, dtype=float)
    assert grid[30:42, 40:56].mean() < grid[5:20, 5:30].mean()


def test_exif_report_flags_editing_software_and_missing_camera():
    _, original, _ = forensics.load_rgb(save(photo(exif={"Software": "Adobe Photoshop 25.0", "DateTime": "2024:01:02 10:00:00"})), 1600)
    fields, flags = forensics.exif_report(original)
    assert fields["Software"].startswith("Adobe Photoshop") and fields["has_exif"] is True
    assert any("Photoshop" in f for f in flags) and any("camera make" in f for f in flags)
    _, bare, _ = forensics.load_rgb(save(photo()), 1600)
    fields, flags = forensics.exif_report(bare)
    assert fields["has_exif"] is False and any("No EXIF" in f for f in flags)
    assert 85 <= fields["jpeg_quality_estimate"] <= 100


def test_jpeg_quality_estimate_tracks_the_save_quality():
    low = forensics.exif_report(forensics.load_rgb(save(photo(quality=40)), 1600)[1])[0]["jpeg_quality_estimate"]
    high = forensics.exif_report(forensics.load_rgb(save(photo(quality=95)), 1600)[1])[0]["jpeg_quality_estimate"]
    assert low < 60 < high


def test_large_images_are_downscaled_for_analysis_but_reported_at_full_size():
    rgb, _, facts = forensics.load_rgb(save(photo(3200, 2400)), 1600)
    assert rgb.shape[:2] == (1200, 1600) and facts["downscaled"] is True and facts["width"] == 3200


# ---- face helpers --------------------------------------------------------------------------------------------------------

def test_face_geometry_and_crop():
    face = fake_face()
    assert face.asymmetry() < 0.05  # mirrored pairs placed symmetrically
    assert 0.03 < face.mouth_openness() < 0.05  # inner lips 4% of face height apart
    crop = crop_face(np.zeros((480, 640, 3), np.uint8), face, margin=0.0)
    assert crop.shape[1] == pytest.approx(0.4 * 640, abs=2) and crop.shape[0] == pytest.approx(0.5 * 480, abs=2)


# ---- image module ----------------------------------------------------------------------------------------------------------

def test_detector_scores_the_whole_image_and_module_has_full_evidence():
    clf = FakeClassifier("m1", 0.9)
    result, info = analyze_image(save(photo()), [clf], FakeFaces([fake_face()]), media())
    assert result.status == "ok" and result.score == 0.9 and result.modality == "image"
    assert clf.seen[0] == (640, 480)  # UnivFD was evaluated on whole images, so it is given the whole image
    assert info.width == 640 and info.height == 480
    assert [e.type for e in result.evidence] == ["heatmap", "heatmap", "metadata", "metadata", "metadata"]
    assert result.evidence[0].data["faces"][0]["w"] == pytest.approx(0.4, abs=0.01)
    assert result.reliability >= 0.6 and result.models == ["m1"]


def test_a_photo_without_a_face_is_scored_as_reliably_as_a_portrait():
    """The detector is not face-specific, so a generated landscape is judged like a generated portrait."""
    without, _ = analyze_image(save(photo()), [FakeClassifier("m1", 0.9)], FakeFaces([]), media())
    with_face, _ = analyze_image(save(photo()), [FakeClassifier("m1", 0.9)], FakeFaces([fake_face()]), media())
    assert without.reliability == with_face.reliability == 0.7
    assert "no face found" in without.summary


def test_two_classifiers_disagreeing_lowers_reliability_and_averages():
    result, _ = analyze_image(save(photo()), [FakeClassifier("a", 0.9), FakeClassifier("b", 0.2)], FakeFaces([fake_face()]), media())
    assert result.score == pytest.approx(0.55)
    assert any("disagree" in item for item in result.limitations)


def test_classifier_failure_falls_back_to_forensics_at_low_reliability():
    result, _ = analyze_image(save(spliced()), [FakeClassifier("a", error=ComponentFailure("model_load_failed", "down"))], FakeFaces([]), media())
    assert result.status == "ok" and result.reliability <= 0.2 and result.error == "down"
    assert any("did not run" in item for item in result.limitations)
    assert result.models == []


def test_small_image_and_heavy_compression_are_named_in_limitations():
    result, _ = analyze_image(save(photo(200, 150, quality=40)), [FakeClassifier("a", 0.8)], FakeFaces([fake_face()]), media())
    assert any("Low resolution (200x150)" in item for item in result.limitations)
    assert any("Heavy JPEG compression" in item for item in result.limitations)
    # Quality 40 is under the fail-safe floor: reliability is capped so the fused verdict is Inconclusive, not a guess.
    assert result.reliability < 0.2 and any("Inconclusive by design" in item for item in result.limitations)
    moderate, _ = analyze_image(save(photo(220, 170, quality=65)), [FakeClassifier("a", 0.8)], FakeFaces([fake_face()]), media())
    assert moderate.reliability == pytest.approx(0.45)


def test_raw_detector_output_is_shown_next_to_the_calibrated_score():
    clf = FakeClassifier("UnivFD", 0.94)
    clf.last_raw = 0.81811
    result, _ = analyze_image(save(photo()), [clf], FakeFaces([]), media())
    reading = next(e.data for e in result.evidence if e.label == "Detector reading")
    assert reading["detectors"][0] == {"model": "UnivFD", "fake_probability": 0.94, "raw_output": 0.81811, "members": None, "error": None}
    assert "calibration" in reading


def test_face_detector_failure_is_survivable():
    result, _ = analyze_image(save(photo()), [FakeClassifier("a", 0.3)], FakeFaces(error=ComponentFailure("face_model_failed", "no model")), media())
    assert result.status == "ok" and result.score == 0.3
    assert any("Face detection did not run" in item for item in result.limitations)


def test_corrupt_image_is_unavailable():
    result, _ = analyze_image(save(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64), [FakeClassifier("a", 0.3)], FakeFaces(), media())
    assert result.status == "unavailable" and result.reliability == 0


# ---- endpoint ------------------------------------------------------------------------------------------------------------

def test_endpoint_routes_images_through_the_image_module():
    app.dependency_overrides[get_image_components] = lambda: ImageComponents([FakeClassifier("m", 0.85)], FakeFaces([fake_face()]))
    response = client.post(URL, files={"file": ("selfie.png", photo(fmt="PNG"), "image/png")})
    assert response.status_code == 200, response.text
    report = DeepTruthReport.model_validate(response.json())
    assert report.media.kind == "image" and report.media.format == "png" and report.media.width == 640
    assert report.verdict == "Likely manipulated" and [m.modality for m in report.modules] == ["image"]
    assert set(report.timings_seconds) == {"image", "total"}
    assert any("not built for face swaps" in item for item in report.limitations)


def test_endpoint_rejects_a_corrupt_png_with_a_report_not_a_crash():
    app.dependency_overrides[get_image_components] = lambda: ImageComponents([FakeClassifier("m", 0.85)], FakeFaces())
    response = client.post(URL, files={"file": ("x.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, "image/png")})
    assert response.status_code == 200 and response.json()["status"] == "failed" and response.json()["verdict"] == "Inconclusive"


def test_univfd_calibration_curve():
    from app.config import get_settings
    from app.deeptruth.modules.univfd import calibrate

    a, b = get_settings().univfd_calibration_a, get_settings().univfd_calibration_b
    decision_point = 1 / (1 + np.exp(b / a))  # raw output where the calibrated score is exactly 0.5
    assert calibrate(decision_point, a, b) == pytest.approx(0.5)
    assert calibrate(0.0001, a, b) < 0.1 and calibrate(0.8, a, b) > 0.9
    assert calibrate(0.0, a, b) > 0 and calibrate(1.0, a, b) < 1  # clipped, never exactly 0 or 1
    scores = [calibrate(p, a, b) for p in (0.001, 0.01, 0.1, 0.5)]
    assert scores == sorted(scores)  # keeps the detector's ranking


def test_model_files_are_verified_by_hash_without_the_network(tmp_path):
    """The real face finder's file check (a fake finder is used everywhere else, so this path needs its own test)."""
    import hashlib

    from app.config import get_settings
    from app.deeptruth.download import ensure_file
    from app.deeptruth.modules.face_analysis import MediaPipeFaceFinder

    model = tmp_path / "face_landmarker.task"
    model.write_bytes(b"model bytes")
    digest = hashlib.sha256(b"model bytes").hexdigest()
    settings = get_settings().model_copy(update={"face_landmarker_path": str(model), "face_landmarker_sha256": digest, "face_landmarker_url": "https://invalid.example/never-fetched"})
    MediaPipeFaceFinder(settings)._ensure_model_file()  # present and matching: no download, no error
    assert model.exists()
    with pytest.raises(ValueError, match="checksum mismatch"):
        ensure_file(model, "https://invalid.example/never-fetched", "0" * 64)
    assert not model.exists()  # a file that fails the check is removed, never loaded


# Fail-safe behaviour through the real endpoint: nothing below may ever come back as "No manipulation detected".
def test_endpoint_never_calls_an_image_real_when_the_detector_is_down():
    app.dependency_overrides[get_image_components] = lambda: ImageComponents([FakeClassifier("m", error=ComponentFailure("model_load_failed", "down"))], FakeFaces())
    body = client.post(URL, files={"file": ("photo.jpg", photo(), "image/jpeg")}).json()
    assert body["verdict"] == "Inconclusive" and body["modules"][0]["status"] == "ok"
    assert any("Without the learned detector" in item for item in body["limitations"])


def test_endpoint_is_inconclusive_on_a_tiny_or_crushed_image_even_with_a_confident_detector():
    app.dependency_overrides[get_image_components] = lambda: ImageComponents([FakeClassifier("m", 0.05)], FakeFaces())
    tiny = client.post(URL, files={"file": ("t.png", photo(120, 90, fmt="PNG"), "image/png")}).json()
    crushed = client.post(URL, files={"file": ("c.jpg", photo(640, 480, quality=35), "image/jpeg")}).json()
    assert tiny["verdict"] == "Inconclusive" and crushed["verdict"] == "Inconclusive"
    assert any("Inconclusive by design" in item for item in tiny["limitations"])


def test_endpoint_wording_for_a_clean_result_says_nothing_was_detected_and_warns():
    app.dependency_overrides[get_image_components] = lambda: ImageComponents([FakeClassifier("m", 0.1)], FakeFaces())
    body = client.post(URL, files={"file": ("photo.jpg", photo(), "image/jpeg")}).json()
    assert body["verdict"] == "No manipulation detected"
    assert body["limitations"][0].startswith('"No manipulation detected" does not prove')


def test_logit_ensemble_averages_logits_calibrates_and_survives_one_member_failing():
    import math

    from app.deeptruth.modules.image_classifier import LogitEnsemble

    a, b = 0.5, 1.0
    ens = LogitEnsemble([FakeClassifier("u", 0.1), FakeClassifier("s", 0.9)], a, b)
    # logit(0.1) = -logit(0.9), so the mean logit is 0 and the calibrated score is sigmoid(b).
    assert ens.fake_probability(Image.new("RGB", (300, 300))) == pytest.approx(1 / (1 + math.exp(-b)))
    assert [m["model"] for m in ens.last_members] == ["u", "s"] and ens.last_raw == pytest.approx(0.5)
    # One member down: the other decides alone and the failure is recorded, never a silent default.
    ens = LogitEnsemble([FakeClassifier("u", error=ComponentFailure("model_load_failed", "down")), FakeClassifier("s", 0.9)], a, b)
    z = a * math.log(0.9 / 0.1) + b
    assert ens.fake_probability(Image.new("RGB", (300, 300))) == pytest.approx(1 / (1 + math.exp(-z)))
    assert ens.last_members[0]["error"] == "down"
    with pytest.raises(ComponentFailure):
        LogitEnsemble([FakeClassifier("u", error=ComponentFailure("model_load_failed", "down"))], a, b).fake_probability(Image.new("RGB", (300, 300)))

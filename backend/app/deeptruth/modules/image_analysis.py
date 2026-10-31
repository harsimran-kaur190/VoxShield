"""Image module: a learned detector as the main scorer, with face landmarks, ELA, noise and EXIF as supporting evidence.

Flow: decode -> score the whole image with UnivFD (calibrated) -> find faces -> compute ELA / noise heatmaps and EXIF
facts -> estimate reliability from what was found -> ModuleResult. UnivFD scores the whole image, as it was trained and
evaluated; it is not a face detector, so photos without a face are scored as reliably as portraits."""

import logging
from collections.abc import Sequence

import numpy as np
from PIL import Image

from app.deeptruth.modules import image_forensics as forensics
from app.deeptruth.modules.face_analysis import Face, FaceFinder
from app.deeptruth.modules.image_classifier import ImageDeepfakeClassifier
from app.deeptruth.schemas import Evidence, MediaInfo, ModuleResult
from app.services.interfaces import ComponentFailure

logger = logging.getLogger("deeptruth.image")

MIN_IMAGE_SIDE = 224  # UnivFD's input size
# Fail-safe floor: below this size or JPEG quality the detector's traces are mostly gone, so the module caps its
# reliability under the fusion threshold and the verdict becomes Inconclusive instead of a guess.
TINY_SIDE = 160
VERY_LOW_QUALITY = 50
NO_VERDICT_RELIABILITY = 0.15  # under fuse.MIN_TOTAL_RELIABILITY (0.2) on its own

KNOWN_WEAKNESSES = [
    "The detectors (UnivFD and a Swin-V2 classifier) were trained to tell real photos from fully generated images. They "
    "are not built for face swaps or local edits in a real photo. Measured on DeepTruth's own held-out set of 180 images "
    "(see the Evaluation page); recompression, resizing and screenshots weaken them.",
    "Re-saving, resizing or screenshotting an image changes its compression traces, so ELA and noise maps mostly "
    "describe the file's last save, not its history.",
    "None of these checks can tell a fabricated scene with a real face from an untouched photo.",
]


def analyze_image(path, classifiers: Sequence[ImageDeepfakeClassifier], faces: FaceFinder, media: MediaInfo, max_side: int = 1600) -> tuple[ModuleResult, MediaInfo]:
    """Never raises for model problems: a failed classifier leaves the forensic evidence and lowers reliability."""
    try:
        rgb, original, facts = forensics.load_rgb(path, max_side)
    except Exception as error:
        logger.error("image decode failed: %s", type(error).__name__)
        result = ModuleResult(modality="image", score=0.5, reliability=0.0, status="unavailable", error="The image could not be decoded.", summary="Image analysis could not run.", limitations=["The image could not be decoded, so nothing was checked."])
        return result, media
    media = media.model_copy(update={"width": facts["width"], "height": facts["height"], "format": facts["format"]})
    h, w = rgb.shape[:2]
    limitations: list[str] = []

    # 1. Faces
    found: list[Face] = []
    face_error = None
    try:
        found = faces.detect(rgb)
    except ComponentFailure as failure:
        face_error = failure.message
    except Exception as error:
        logger.error("face detection failed: %s", type(error).__name__)
        face_error = "Face detection failed unexpectedly."
    target = Image.fromarray(rgb)

    # 2. Learned detector on the whole image
    readings: list[dict] = []
    for clf in classifiers:
        try:
            score_value = clf.fake_probability(target)
            # Proof the learned detector really ran on this request (not a silent fallback to ELA/noise).
            logger.info("image classifier %s ran: raw=%s calibrated=%.3f input=%dx%d", clf.name, _raw(clf), score_value, target.width, target.height)
            readings.append({"model": clf.name, "fake_probability": round(score_value, 4), "raw_output": _raw(clf), "members": getattr(clf, "last_members", None), "error": None})
        except ComponentFailure as failure:
            readings.append({"model": clf.name, "fake_probability": None, "raw_output": None, "error": failure.message})
        except Exception as error:
            logger.error("image classifier %s failed: %s", clf.name, type(error).__name__)
            readings.append({"model": clf.name, "fake_probability": None, "raw_output": None, "error": "The classifier failed unexpectedly."})
    probabilities = [r["fake_probability"] for r in readings if r["fake_probability"] is not None]

    # 3. Supporting forensics
    ela_map, ela_stats = forensics.error_level_analysis(rgb)
    noise_map, noise_stats = forensics.noise_inconsistency(rgb)
    exif, exif_flags = forensics.exif_report(original)

    # 4. Score: the classifiers decide. Without them the crude forensic reading stands in, at low reliability.
    if probabilities:
        score = float(np.mean(probabilities))
        classifier_ran = True
    else:
        score = forensics.supporting_score(ela_stats, noise_stats)
        classifier_ran = False
        limitations.append("The learned classifier did not run, so the score comes only from ELA and noise statistics, which are crude and uncalibrated.")

    reliability, reasons = estimate_reliability(classifier_ran, probabilities, found, face_error, facts, media, exif)
    limitations.extend(reasons)
    limitations.extend(exif_flags)
    limitations.extend(KNOWN_WEAKNESSES)

    face_boxes = [f.metrics(w, h)["box"] for f in found]
    evidence = [
        Evidence(type="heatmap", label="Error Level Analysis", data={"values": ela_map, "faces": face_boxes, "stats": ela_stats, "note": f"Difference after re-saving as JPEG at quality {forensics.ELA_QUALITY}. Bright = changed more. Isolated bright regions can mark pasted or re-compressed areas; an even map says little."}),
        Evidence(type="heatmap", label="Noise residual", data={"values": noise_map, "faces": face_boxes, "stats": noise_stats, "note": "Strength of fine sensor noise per block. A camera photo is fairly even; a region with different noise may come from another source."}),
        Evidence(type="metadata", label="Face landmarks", data={"faces_found": len(found), "error": face_error, "faces": [f.metrics(w, h) for f in found[:5]], "note": "MediaPipe Face Landmarker, 478 points. Asymmetry is the mirror error of paired landmarks as a fraction of eye distance; mouth openness is the inner-lip gap over face height."}),
        Evidence(type="metadata", label="EXIF metadata", data=exif),
        Evidence(type="metadata", label="Detector reading", data={
            "input": "whole image: UnivFD sees the centre 224 px at native resolution, the Swin-V2 model the whole image resized to 256 px",
            "detectors": readings,
            "calibration": "score = sigmoid(a x mean_logit + b), fitted on the calibration half of eval/images (180 images); 0.5 is the fitted decision point, 0.4-0.6 is reported as Inconclusive",
            "analyzed_size": f"{facts['analyzed_width']}x{facts['analyzed_height']}",
            "downscaled": facts["downscaled"],
        }),
    ]
    summary = _summary(score, classifier_ran, found, readings)
    return ModuleResult(
        modality="image", score=round(min(max(score, 0.0), 1.0), 3), reliability=round(reliability, 2), evidence=evidence,
        limitations=limitations, summary=summary, models=[r["model"] for r in readings if r["error"] is None],
        status="ok", error=None if classifier_ran else "; ".join(r["error"] for r in readings if r["error"]) or None,
    ), media


def estimate_reliability(classifier_ran: bool, probabilities: list[float], found: list[Face], face_error: str | None, facts: dict, media: MediaInfo, exif: dict) -> tuple[float, list[str]]:
    """Heuristic 0-1 weight with a reason for each deduction. Starts at 0.7, close to the detector's held-out accuracy
    on DeepTruth's check (backend/evaluation/IMAGE_RESULTS.md). Without the classifier, or on a tiny or badly
    compressed image, it is capped below the fusion threshold: no verdict rather than a guess."""
    reliability, reasons = (0.7 if classifier_ran else 0.1), []
    if not classifier_ran:
        reasons.append("Without the learned detector no verdict is given; the ELA and noise maps are shown for inspection only.")
    if face_error:
        reasons.append(f"Face detection did not run ({face_error}); face boxes and landmark facts are missing, the score is unaffected.")
    elif found and len(found) > 1:
        reasons.append(f"{len(found)} faces were found. The detector scores the image as a whole, so it cannot say which face, if any, was altered.")
    if min(facts["width"], facts["height"]) < MIN_IMAGE_SIDE:
        reliability -= 0.15
        reasons.append(f"Low resolution ({facts['width']}x{facts['height']}): it was scaled up for the detector, and compression hides the traces every check looks for.")
    if facts.get("downscaled") and max(facts["width"], facts["height"]) > 3 * 1600:
        reasons.append(f"Very large image ({facts['width']}x{facts['height']}): the detector sees only its central 224 px after the forensic downscale, a small part of the picture.")
    quality = exif.get("jpeg_quality_estimate")
    if quality is not None and quality < 70:
        reliability -= 0.1
        reasons.append(f"Heavy JPEG compression (estimated quality about {quality}) blurs forensic traces.")
    if len(probabilities) >= 2 and (max(probabilities) >= 0.5) != (min(probabilities) >= 0.5):
        reliability -= 0.15
        reasons.append("The image detectors disagree about this image.")
    if probabilities and 0.4 <= float(np.mean(probabilities)) <= 0.6:
        reliability -= 0.1
        reasons.append("The detector's calibrated score sits near its decision point, where it carries little information.")
    if min(facts["width"], facts["height"]) < TINY_SIDE or (quality is not None and quality < VERY_LOW_QUALITY):
        reliability = min(reliability, NO_VERDICT_RELIABILITY)
        reasons.append(f"Too small or too heavily compressed for a verdict (under {TINY_SIDE} px or JPEG quality under {VERY_LOW_QUALITY}): the result is Inconclusive by design.")
    return min(max(reliability, 0.05), 0.9), reasons


def _raw(clf) -> float | None:
    """The detector's uncalibrated output, when it exposes one (UnivFD does)."""
    raw = getattr(clf, "last_raw", None)
    return round(raw, 5) if isinstance(raw, float) else None


def _summary(score: float, classifier_ran: bool, found: list[Face], readings: list[dict]) -> str:
    faces = f"{len(found)} face{'s' if len(found) != 1 else ''} found" if found else "no face found"
    if not classifier_ran:
        return f"The learned detector was unavailable; the ELA and noise reading is {score:.2f} on a crude scale ({faces})."
    names = ", ".join(r["model"] for r in readings if r["error"] is None)
    lean = "leans manipulated (generated)" if score >= 0.6 else "leans authentic" if score <= 0.4 else "is undecided"
    return f"{names} scored the image at {score:.2f} after calibration and {lean}; {faces}."

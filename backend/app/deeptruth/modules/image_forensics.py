"""Classical image forensics: Error Level Analysis, noise-residual inconsistency and EXIF metadata.

These are SUPPORTING signals. Each is easy to explain and easy to fool: a single re-save, a screenshot or a social-media
upload changes all of them. They are shown as heatmaps and facts next to the learned classifier, and they only carry
the score when the classifier cannot run."""

import io
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps

HEATMAP_SIDE = 96  # longest side of the heatmaps sent to the browser
ELA_QUALITY = 90
NOISE_BLOCK = 16

# Image editors and generators that write their name into EXIF "Software". Presence proves an edit, not a forgery.
EDITING_SOFTWARE = ("photoshop", "gimp", "lightroom", "affinity", "pixelmator", "snapseed", "facetune", "picsart", "canva", "midjourney", "stable diffusion", "dall", "firefly")


def load_rgb(path, max_side: int) -> tuple[np.ndarray, Image.Image, dict[str, Any]]:
    """Decode the image, apply the EXIF rotation, and scale it down if it is very large.

    Returns the RGB array used for analysis, the original PIL image (for EXIF and JPEG tables), and basic facts."""
    original = Image.open(path)
    original.load()
    facts = {"format": (original.format or "unknown").lower(), "width": original.width, "height": original.height, "mode": original.mode}
    image = ImageOps.exif_transpose(original).convert("RGB")
    scale = min(1.0, max_side / max(image.size))
    if scale < 1.0:
        image = image.resize((max(int(image.width * scale), 1), max(int(image.height * scale), 1)), Image.LANCZOS)
    facts["analyzed_width"], facts["analyzed_height"], facts["downscaled"] = image.width, image.height, scale < 1.0
    return np.asarray(image), original, facts


def _shrink(values: np.ndarray) -> list[list[int]]:
    """Scale a 2-D float map to at most HEATMAP_SIDE on its longest side and to 0-255 integers (0 = lowest)."""
    h, w = values.shape
    scale = HEATMAP_SIDE / max(h, w)
    small = cv2.resize(values.astype(np.float32), (max(int(w * scale), 1), max(int(h * scale), 1)), interpolation=cv2.INTER_AREA)
    top = float(np.percentile(small, 99.5)) or 1.0
    return (np.clip(small / top, 0, 1) * 255).astype(np.uint8).tolist()


def error_level_analysis(rgb: np.ndarray, quality: int = ELA_QUALITY) -> tuple[list[list[int]], dict[str, float]]:
    """Re-save as JPEG and measure what changed. Regions that were pasted in or re-compressed at a different quality
    often stand out from the rest. Uniform maps say little; strong isolated blobs are worth a look."""
    buffer = io.BytesIO()
    Image.fromarray(rgb).save(buffer, "JPEG", quality=quality)
    buffer.seek(0)
    resaved = np.asarray(Image.open(buffer).convert("RGB"))
    diff = np.abs(rgb.astype(np.int16) - resaved.astype(np.int16)).mean(axis=2)
    mean, std = float(diff.mean()), float(diff.std())
    # Fraction of 16x16 blocks whose ELA is more than 2.5x the image median: "hot spots".
    blocks = _block_means(diff, NOISE_BLOCK)
    median = float(np.median(blocks)) or 1e-6
    hot = float((blocks > 2.5 * median).mean())
    return _shrink(diff), {"mean": round(mean, 3), "std": round(std, 3), "hot_block_fraction": round(hot, 4)}


def noise_inconsistency(rgb: np.ndarray, block: int = NOISE_BLOCK) -> tuple[list[list[int]], dict[str, float]]:
    """Sensor noise is roughly even across a photo from one camera. A face swapped in from another image, or a
    generated region, often carries a different noise level. The map shows per-block noise strength."""
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    residual = gray - cv2.medianBlur(gray.astype(np.uint8), 3).astype(np.float32)
    h, w = residual.shape
    bh, bw = max(h // block, 1), max(w // block, 1)
    trimmed = residual[: bh * block, : bw * block]
    stds = trimmed.reshape(bh, block, bw, block).std(axis=(1, 3))
    mean = float(stds.mean()) or 1e-6
    cv = float(stds.std() / mean)  # coefficient of variation: 0 = perfectly even noise
    return _shrink(cv2.resize(stds, (w, h), interpolation=cv2.INTER_NEAREST)), {"mean_noise": round(mean, 3), "variation": round(cv, 4)}


def _block_means(values: np.ndarray, block: int) -> np.ndarray:
    h, w = values.shape
    bh, bw = max(h // block, 1), max(w // block, 1)
    return values[: bh * block, : bw * block].reshape(bh, block, bw, block).mean(axis=(1, 3))


def exif_report(original: Image.Image) -> tuple[dict[str, Any], list[str]]:
    """What the file says about itself, and plain-language flags. Missing metadata is normal for screenshots and
    anything that passed through a messaging app, so it lowers confidence rather than raising suspicion."""
    from PIL.ExifTags import TAGS

    exif = original.getexif()
    fields: dict[str, Any] = {}
    for tag_id, value in exif.items():
        name = TAGS.get(tag_id, str(tag_id))
        if name in ("Make", "Model", "Software", "DateTime", "DateTimeOriginal", "DateTimeDigitized", "Orientation", "ImageWidth", "ImageLength", "XResolution", "YResolution", "LensModel"):
            fields[name] = str(value).strip("\x00 ")
    # Camera timestamps live in the Exif sub-IFD.
    try:
        sub = exif.get_ifd(0x8769)
        for tag_id, value in sub.items():
            name = TAGS.get(tag_id, str(tag_id))
            if name in ("DateTimeOriginal", "DateTimeDigitized", "LensModel"):
                fields[name] = str(value).strip("\x00 ")
    except Exception:
        pass

    flags: list[str] = []
    software = fields.get("Software", "").lower()
    if software and any(s in software for s in EDITING_SOFTWARE):
        flags.append(f"EXIF says the file was saved by '{fields['Software']}': it was edited or generated by software, which proves an edit but not a forgery.")
    if not exif:
        flags.append("No EXIF metadata at all. Usual for screenshots, social-media downloads and generated images, so it cannot tell the two apart.")
    elif "Make" not in fields and "Model" not in fields:
        flags.append("No camera make or model in the metadata; the file did not come straight from a camera, or the metadata was stripped.")
    if fields.get("DateTime") and fields.get("DateTimeOriginal") and fields["DateTime"] != fields["DateTimeOriginal"]:
        flags.append(f"Modified ({fields['DateTime']}) after capture ({fields['DateTimeOriginal']}).")
    quant = getattr(original, "quantization", None)
    fields["jpeg_quality_estimate"] = estimate_jpeg_quality(quant) if quant else None
    fields["has_exif"] = bool(exif)
    return fields, flags


# The IJG standard luminance quantization table (libjpeg jcparam.c), which encoders scale by quality.
_IJG_LUMINANCE = np.array([
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
], dtype=np.float32)


def estimate_jpeg_quality(tables: dict) -> int | None:
    """Rough libjpeg-style quality (1-100) from the luminance quantization table. libjpeg scales the standard table by
    S = 5000/Q (Q < 50) or 200 - 2Q (Q >= 50); this inverts the mean scale factor. Other encoders differ a little."""
    try:
        table = np.array(tables[0], dtype=np.float32)
        if table.size != 64:
            return None
    except Exception:
        return None
    scale = float(table.mean() / _IJG_LUMINANCE.mean() * 100)
    quality = 5000 / scale if scale >= 100 else (200 - scale) / 2
    return int(np.clip(round(quality), 1, 100))


def supporting_score(ela: dict[str, float], noise: dict[str, float]) -> float:
    """A crude 0-1 reading from ELA hot spots and noise variation, used ONLY when the learned classifier is down.
    Not calibrated on any dataset; it is a tie-breaker with a low reliability, never a verdict on its own."""
    hot = min(ela["hot_block_fraction"] / 0.15, 1.0)  # 15% hot blocks saturates
    variation = min(max(noise["variation"] - 0.3, 0.0) / 0.7, 1.0)  # even noise ~0.2-0.3; above 1.0 is very uneven
    return round(0.5 * hot + 0.5 * variation, 3)

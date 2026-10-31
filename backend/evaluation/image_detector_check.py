"""Check the DeepTruth image detector on labelled real and AI-generated images, and fit its calibration.

    python -m evaluation.image_detector_check            # fetch samples (once), score, calibrate, write results
    python -m evaluation.image_detector_check --compare  # also score the two earlier ViT face classifiers

Samples (fetched through the Hugging Face dataset viewer, cached in evaluation/cache/images/):
  * faces:     40 real (FFHQ photos) + 40 StyleGAN faces, test split of TheKernel01/140k-Real-and-Fake-Faces
  * diffusion: real web photos + 40 images generated from their captions by DeepFloyd IF, Stable Diffusion 1.4, 2.1
               and XL (10 each), from elsaEU/ELSA_D3. Real photos are fetched from their original URLs; dead links
               are skipped. Images under 224 px are skipped (the detector's input size).

Method: each (sample, label) group is split alternately into a calibration half and a held-out half. A logistic curve
score = sigmoid(a * logit(raw) + b) is fitted on the calibration half only; every number reported is on the held-out
half. Small samples: treat the figures as a sanity check, not a benchmark."""

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))

CACHE = ROOT / "cache" / "images"
RESULTS = ROOT / "results" / "image"
VIEWER = "https://datasets-server.huggingface.co/rows?dataset={dataset}&config=default&split={split}&offset={offset}&length={length}"
PER_CLASS = 40


def _curl(args: list[str]) -> subprocess.CompletedProcess:
    # curl, not urllib: Python on macOS often lacks a CA bundle, and the viewer's signed image URLs are plain HTTPS.
    return subprocess.run(["curl", "-sL", "--max-time", "30", *args], capture_output=True, text=True)


def fetch_faces(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    got = {"real": len(list(folder.glob("real_*"))), "fake": len(list(folder.glob("fake_*")))}
    for offset in range(0, 20000, 500):
        if min(got.values()) >= PER_CLASS:
            return
        page = json.loads(_curl([VIEWER.format(dataset="TheKernel01/140k-Real-and-Fake-Faces", split="test", offset=offset, length=4)]).stdout)
        for row in page["rows"]:
            label = ["real", "fake"][row["row"]["label"]]
            target = folder / f"{label}_{row['row_idx']}.jpg"
            if got[label] < PER_CLASS and not target.exists():
                _curl(["-o", str(target), row["row"]["image"]["src"]])
                got[label] += 1


def fetch_diffusion(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    real, fake = len(list(folder.glob("real_*"))), len(list(folder.glob("fake_*")))
    for offset in range(0, 4000, 100):
        if real >= PER_CLASS and fake >= PER_CLASS:
            return
        try:
            rows = json.loads(_curl([VIEWER.format(dataset="elsaEU/ELSA_D3", split="train", offset=offset, length=3)]).stdout)["rows"]
        except (json.JSONDecodeError, KeyError):
            continue
        for r in rows:
            row = r["row"]
            if fake < PER_CLASS:
                generator = fake % 4
                _curl(["-o", str(folder / f"fake_{row['id']}_g{generator}.jpg"), row[f"image_gen{generator}"]["src"]])
                fake += 1
            if real < PER_CLASS:
                target = folder / f"real_{row['id']}.jpg"
                _curl(["--max-time", "15", "-o", str(target), row["url"]])
                if _is_jpeg(target):
                    real += 1
                else:
                    target.unlink(missing_ok=True)


def _is_jpeg(path: Path) -> bool:
    try:
        with Image.open(path) as image:
            return image.format == "JPEG" and path.stat().st_size > 8000
    except Exception:
        return False


def logit(p: float) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def fit_logistic(z: np.ndarray, y: np.ndarray, iters: int = 20000, lr: float = 0.1) -> tuple[float, float]:
    """One-variable logistic regression by gradient descent on standardised inputs; returns (a, b) for the raw logit."""
    mu, sd = z.mean(), z.std() or 1.0
    x = (z - mu) / sd
    a = b = 0.0
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(a * x + b)))
        a -= lr * float(((p - y) * x).mean())
        b -= lr * float((p - y).mean())
    return a / sd, b - a * mu / sd


def auc(fake: list[float], real: list[float]) -> float:
    """Chance that a random fake scores above a random real image (0.5 = no better than a coin)."""
    f, r = np.array(fake)[:, None], np.array(real)[None, :]
    return float((f > r).mean() + 0.5 * (f == r).mean())


def split(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    groups: dict[tuple, list[dict]] = {}
    for row in rows:
        groups.setdefault((row["sample"], row["label"]), []).append(row)
    calibration, held_out = [], []
    for group in groups.values():
        for i, row in enumerate(sorted(group, key=lambda r: r["file"])):
            (calibration if i % 2 == 0 else held_out).append(row)
    return calibration, held_out


def score_images(compare: bool) -> list[dict]:
    from app.config import get_settings
    from app.deeptruth.dependencies import get_image_components
    from app.deeptruth.fusion.fuse import fuse
    from app.deeptruth.modules.image_analysis import analyze_image
    from app.deeptruth.modules.image_classifier import HfImageClassifier
    from app.deeptruth.modules.univfd import UnivFDClassifier
    from app.deeptruth.schemas import MediaInfo

    settings = get_settings()
    univfd = UnivFDClassifier(settings)
    faces = get_image_components().faces
    others = [HfImageClassifier(settings.image_model_id, settings.image_model_revision), HfImageClassifier(settings.image_secondary_model_id, settings.image_secondary_model_revision)] if compare else []
    rows = []
    for sample in ("faces", "diffusion"):
        for path in sorted((CACHE / sample).glob("*.jpg")):
            with Image.open(path) as image:
                image = image.convert("RGB")
            if min(image.size) < 224:
                continue
            row = {"sample": sample, "file": path.name, "label": path.name.split("_")[0], "raw": univfd.raw_probability(image)}
            for other in others:
                row[other.name] = other.fake_probability(image)
            # The full image module, so the verdict counts are what a user of the dashboard would see.
            media = MediaInfo(filename=path.name, kind="image", format="jpeg", size_bytes=path.stat().st_size)
            module, media = analyze_image(path, [univfd], faces, media, settings.image_max_side)
            row["module_score"], row["verdict"] = module.score, fuse([module], media).verdict
            rows.append(row)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--compare", action="store_true", help="also score the earlier ViT face classifiers")
    args = parser.parse_args()

    fetch_faces(CACHE / "faces")
    fetch_diffusion(CACHE / "diffusion")
    rows = score_images(args.compare)
    calibration, held_out = split(rows)

    z = np.array([logit(r["raw"]) for r in calibration])
    y = np.array([r["label"] == "fake" for r in calibration], dtype=float)
    a, b = fit_logistic(z, y)

    lines = ["# DeepTruth image detector check", "", "Generated by `python -m evaluation.image_detector_check`. Small samples: a sanity check, not a benchmark.", ""]
    lines += [f"Calibration fitted on {len(calibration)} images: `a = {a:.3f}`, `b = {b:.3f}` (score = sigmoid(a x logit(raw) + b)).", ""]
    lines += ["## Held-out ranking (AUC, 0.5 = chance)", "", "| Detector | Faces (StyleGAN) | Diffusion (IF, SD 1.4/2.1/XL) |", "| --- | --- | --- |"]
    detectors = ["raw"] + [k for k in rows[0] if k not in ("sample", "file", "label", "raw", "module_score", "verdict")]
    for key in detectors:
        cells = []
        for sample in ("faces", "diffusion"):
            sub = [r for r in held_out if r["sample"] == sample]
            cells.append(f"{auc([r[key] for r in sub if r['label'] == 'fake'], [r[key] for r in sub if r['label'] == 'real']):.2f}")
        lines.append(f"| {'UnivFD (DeepTruth default)' if key == 'raw' else key} | {cells[0]} | {cells[1]} |")

    lines += ["", "## Held-out verdicts from the full image module (what the dashboard shows)", "", "| Sample | Truth | n | Likely manipulated | Inconclusive | Likely authentic | Correct when decisive |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for sample in ("faces", "diffusion"):
        for truth in ("fake", "real"):
            sub = [r for r in held_out if r["sample"] == sample and r["label"] == truth]
            counts = {v: sum(r["verdict"] == v for r in sub) for v in ("Likely manipulated", "Inconclusive", "Likely authentic")}
            decisive = counts["Likely manipulated"] + counts["Likely authentic"]
            correct = counts["Likely manipulated"] if truth == "fake" else counts["Likely authentic"]
            lines.append(f"| {sample} | {truth} | {len(sub)} | {counts['Likely manipulated']} | {counts['Inconclusive']} | {counts['Likely authentic']} | {correct}/{decisive} |")
    calibrated = [1 / (1 + math.exp(-(a * logit(r["raw"]) + b))) for r in held_out]
    accuracy = np.mean([(p >= 0.5) == (r["label"] == "fake") for p, r in zip(calibrated, held_out)])
    lines += ["", f"Held-out accuracy at the fitted decision point (0.5 after calibration): {accuracy:.2f} on {len(held_out)} images.", ""]
    lines += ["Note: the verdicts above use the calibration in `app/config.py` at the time of the run. If the fitted `a`, `b`", "differ from those settings, update the settings and re-run so the two agree."]

    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "scores.json").write_text(json.dumps({"a": a, "b": b, "rows": rows}, indent=1))
    (ROOT / "IMAGE_RESULTS.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()

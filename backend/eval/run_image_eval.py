"""Measure the image detector on eval/images/{real,fake}/ through the SAME code path the API and the extension use
(detect_media -> analyze_image -> fuse), and write the numbers to eval/results/<name>.json.

    python -m eval.run_image_eval --name baseline
    python -m eval.run_image_eval --name baseline_jpeg50 --transform jpeg50      # robustness (Step 4)
    python -m eval.run_image_eval --name baseline_half --transform half
    python -m eval.run_image_eval --name baseline_screenshot --transform screenshot

Split: inside each (source, label) group the files are sorted by name and alternate calibration / test. Thresholds and
calibration may be chosen on the calibration half only; every headline number is from the test half, which is never
used for tuning. "Fake" is the positive class throughout."""

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))

from app.config import get_settings  # noqa: E402
from app.deeptruth.dependencies import get_image_components  # noqa: E402
from app.deeptruth.fusion.fuse import fuse  # noqa: E402
from app.deeptruth.modules.image_analysis import analyze_image  # noqa: E402
from app.deeptruth.preprocess.detect_type import detect_media  # noqa: E402

IMAGES = ROOT / "images"
RESULTS = ROOT / "results"
DECISION = 0.5  # the calibrated score's decision point; the API's verdict bands sit at 0.4 / 0.6 around it


def transform(path: Path, kind: str | None, workdir: Path) -> Path:
    """A copy of the image altered the way media gets altered on its way around the web. None = the file as is."""
    if kind is None:
        return path
    image = Image.open(path).convert("RGB")
    out = workdir / f"{path.stem}_{kind}.jpg"
    if kind == "jpeg50":  # re-shared through a chat app or CDN
        image.save(out, "JPEG", quality=50)
    elif kind == "half":  # a thumbnail at half size, then a normal JPEG save
        image = image.resize((max(image.width // 2, 1), max(image.height // 2, 1)), Image.LANCZOS)
        image.save(out, "JPEG", quality=90)
    elif kind == "screenshot":  # shown on a 1280 px wide screen and screenshotted (PNG): resampled, no EXIF
        scale = min(1.0, 1280 / image.width)
        image = image.resize((max(int(image.width * scale), 1), max(int(image.height * scale), 1)), Image.BILINEAR)
        out = workdir / f"{path.stem}_{kind}.png"
        image.save(out, "PNG")
    else:
        raise SystemExit(f"unknown transform {kind}")
    return out


def score_file(path: Path, components, settings) -> dict:
    media = detect_media(path, path.name, path.stat().st_size)
    module, media = analyze_image(path, components.classifiers, components.faces, media, max_side=settings.image_max_side)
    report = fuse([module], media, {})
    reading = next((e.data for e in module.evidence if e.label == "Detector reading"), {})
    raws = [d.get("raw_output") for d in reading.get("detectors", []) if d.get("raw_output") is not None]
    return {"score": report.manipulation_likelihood, "raw": raws[0] if raws else None, "verdict": report.verdict, "reliability": module.reliability, "status": module.status, "error": module.error}


def auc(scores: list[float], labels: list[int]) -> float | None:
    """Area under the ROC curve by rank (Mann-Whitney). 0.5 = chance, 1.0 = perfect ranking."""
    pos = [s for s, y in zip(scores, labels) if y == 1]
    neg = [s for s, y in zip(scores, labels) if y == 0]
    if not pos or not neg:
        return None
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return round(wins / (len(pos) * len(neg)), 3)


def metrics(rows: list[dict], threshold: float = DECISION) -> dict:
    """Confusion matrix and rates at `threshold` on the calibrated score, plus AUC and the verdict distribution."""
    labels = [1 if r["label"] == "fake" else 0 for r in rows]
    scores = [r["score"] for r in rows]
    pred = [1 if s >= threshold else 0 for s in scores]
    tp = sum(p and y for p, y in zip(pred, labels))
    tn = sum((not p) and (not y) for p, y in zip(pred, labels))
    fp = sum(p and not y for p, y in zip(pred, labels))
    fn = sum((not p) and y for p, y in zip(pred, labels))
    verdicts: dict[str, dict[str, int]] = {}
    for r in rows:
        verdicts.setdefault(r["label"], {}).setdefault(r["verdict"], 0)
        verdicts[r["label"]][r["verdict"]] += 1

    def mean_score(label: str) -> float | None:
        values = [r["score"] for r in rows if r["label"] == label]
        return round(float(np.mean(values)), 3) if values else None

    def median_raw(label: str) -> float | None:
        values = [r["raw"] for r in rows if r["label"] == label and r["raw"] is not None]
        return round(float(np.median(values)), 4) if values else None

    return {
        "n": len(rows), "n_real": labels.count(0), "n_fake": labels.count(1), "threshold": threshold,
        "confusion": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
        "accuracy": round((tp + tn) / len(rows), 3) if rows else None,
        "precision_fake": round(tp / (tp + fp), 3) if tp + fp else None,
        "recall_fake": round(tp / (tp + fn), 3) if tp + fn else None,
        "specificity_real": round(tn / (tn + fp), 3) if tn + fp else None,
        "auc": auc(scores, labels),
        "mean_score": {"real": mean_score("real"), "fake": mean_score("fake")},
        "median_raw": {"real": median_raw("real"), "fake": median_raw("fake")},
        "verdicts": verdicts,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True, help="results file name, e.g. baseline")
    parser.add_argument("--transform", choices=["jpeg50", "half", "screenshot"], default=None)
    parser.add_argument("--limit", type=int, default=None, help="per class, for a quick run")
    args = parser.parse_args()

    settings = get_settings()
    components = get_image_components()
    rows: list[dict] = []
    started = time.perf_counter()
    with tempfile.TemporaryDirectory() as tmp:
        for label in ("real", "fake"):
            files = sorted((IMAGES / label).iterdir())[: args.limit]
            seen: dict[str, int] = {}
            for path in files:
                source, generator = path.stem.split("_")[0], path.stem.split("_")[2]
                seen[source] = seen.get(source, 0) + 1
                split = "calibration" if seen[source] % 2 == 1 else "test"  # alternate within each source
                result = score_file(transform(path, args.transform, Path(tmp)), components, settings)
                rows.append({"file": path.name, "label": label, "source": source, "generator": generator, "split": split, **result})
                print(f"{split:12} {label:4} {source:9} {generator:18} score={result['score']:.3f} raw={result['raw']} {result['verdict']}", flush=True)

    test = [r for r in rows if r["split"] == "test"]
    cal = [r for r in rows if r["split"] == "calibration"]
    generators = sorted({r["generator"] for r in test if r["label"] == "fake"})
    out = {
        "name": args.name, "transform": args.transform, "generated_at": time.strftime("%Y-%m-%d %H:%M"),
        "detector": [c.name for c in components.classifiers], "seconds": round(time.perf_counter() - started, 1),
        "calibration": {"a": settings.univfd_calibration_a, "b": settings.univfd_calibration_b},
        "split_sizes": {"calibration": len(cal), "test": len(test)},
        "test": metrics(test),
        "test_by_source": {s: metrics([r for r in test if r["source"] == s]) for s in sorted({r["source"] for r in test})},
        "test_fake_recall_by_generator": {g: {"n": sum(1 for r in test if r["label"] == "fake" and r["generator"] == g), "detected": sum(1 for r in test if r["label"] == "fake" and r["generator"] == g and r["score"] >= DECISION)} for g in generators},
        "calibration_set": metrics(cal),
        "rows": rows,
    }
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"{args.name}.json").write_text(json.dumps(out, indent=1))
    t = out["test"]
    print(f"\n== TEST SET ({t['n']} images: {t['n_real']} real, {t['n_fake']} fake) ==")
    print(f"accuracy {t['accuracy']}  precision(fake) {t['precision_fake']}  recall(fake) {t['recall_fake']}  specificity(real) {t['specificity_real']}  AUC {t['auc']}")
    print(f"confusion {t['confusion']}  mean score real/fake {t['mean_score']}  median raw real/fake {t['median_raw']}")
    print("verdicts", json.dumps(t["verdicts"]))
    for s, m in out["test_by_source"].items():
        print(f"  {s:9} n={m['n']:3} acc={m['accuracy']} recall(fake)={m['recall_fake']} spec(real)={m['specificity_real']} AUC={m['auc']}")
    print("fake recall by generator:", {g: f"{v['detected']}/{v['n']}" for g, v in out["test_fake_recall_by_generator"].items()})
    print(f"wrote {RESULTS / (args.name + '.json')}")


if __name__ == "__main__":
    main()

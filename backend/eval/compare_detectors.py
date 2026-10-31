"""Score every image in eval/images with several candidate detectors and rank them by AUC, so the choice of model is
made on data rather than on download counts. Models are picked on the CALIBRATION half; the TEST half is reported for
the record and is never used to choose.

    python -m eval.compare_detectors                 # all candidates
    python -m eval.compare_detectors --only Organika/sdxl-detector

Each Hugging Face candidate is run with its own preprocessing (AutoImageProcessor), as its authors intended. The
positive class is read from id2label: any label named artificial / ai / fake / dalle / sd counts as "fake".
UnivFD is included twice: as deployed (centre crop at native resolution) and with the image first resized so its
shorter side is 224 px, to test whether the crop is what hurts on large photos."""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))

from app.config import get_settings  # noqa: E402
from app.deeptruth.modules.univfd import CROP, UnivFDClassifier  # noqa: E402
from eval.run_image_eval import IMAGES, RESULTS, auc  # noqa: E402

# (model id, pinned commit, licence) checked on 2026-10-31.
CANDIDATES = [
    ("Organika/sdxl-detector", "b37fede8562cb72b89ec201c0987f96ba21b518a", "CC BY-NC 3.0"),
    ("umm-maybe/AI-image-detector", "c7e223baf11bc40528af364ba7bdea030ef42f9e", "CC BY 4.0"),
    ("haywoodsloan/ai-image-detector-deploy", "4ae1822603cb1ec980c217cfde1ef1b8e0477a16", "Apache 2.0"),
    ("Ateeqq/ai-vs-human-image-detector", "60e82406916921b823616bee33397baab38af3f0", "Apache 2.0"),
    ("dima806/ai_vs_real_image_detection", "5d647683672ffd0080441f4e8b4345934c44cc61", "Apache 2.0"),
]
FAKE_LABELS = {"artificial", "ai", "fake", "dalle", "sd"}


def files() -> list[dict]:
    out = []
    for label in ("real", "fake"):
        seen: dict[str, int] = {}
        for path in sorted((IMAGES / label).iterdir()):
            source = path.stem.split("_")[0]
            seen[source] = seen.get(source, 0) + 1
            out.append({"path": path, "label": label, "source": source, "generator": path.stem.split("_")[2], "split": "calibration" if seen[source] % 2 == 1 else "test"})
    return out


def load_image(path: Path) -> Image.Image:
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def hf_scorer(model_id: str, revision: str):
    from transformers import AutoImageProcessor, AutoModelForImageClassification

    processor = AutoImageProcessor.from_pretrained(model_id, revision=revision)
    model = AutoModelForImageClassification.from_pretrained(model_id, revision=revision).eval()
    fake_idx = [i for i, name in model.config.id2label.items() if name.lower() in FAKE_LABELS]
    if not fake_idx:
        raise SystemExit(f"{model_id}: cannot tell which label is fake: {model.config.id2label}")

    def score(image: Image.Image) -> float:
        with torch.inference_mode():
            logits = model(**processor(images=image, return_tensors="pt")).logits
        probs = torch.softmax(logits.float(), dim=-1)[0]
        return float(sum(probs[i] for i in fake_idx))

    return score, model.config.id2label


def univfd_scorers():
    clf = UnivFDClassifier(get_settings())
    clf.ensure_loaded()

    def resized(image: Image.Image) -> float:
        scale = CROP / min(image.size)
        return clf.raw_probability(image.resize((max(round(image.width * scale), CROP), max(round(image.height * scale), CROP)), Image.BICUBIC))

    return [("UnivFD as deployed (centre crop)", clf.raw_probability), ("UnivFD resize-224 then crop", resized)]


def evaluate(name: str, score, rows: list[dict]) -> dict:
    started = time.perf_counter()
    scores = []
    for r in rows:
        try:
            scores.append(score(load_image(r["path"])))
        except Exception as error:  # a broken file should not sink the whole comparison
            print(f"  {r['path'].name}: {type(error).__name__}", file=sys.stderr)
            scores.append(None)
    per_image = (time.perf_counter() - started) / len(rows)
    result = {"name": name, "seconds_per_image": round(per_image, 2), "scores": {r["path"].name: s for r, s in zip(rows, scores)}}
    for split in ("calibration", "test"):
        idx = [i for i, r in enumerate(rows) if r["split"] == split and scores[i] is not None]
        labels = [1 if rows[i]["label"] == "fake" else 0 for i in idx]
        values = [scores[i] for i in idx]
        by_source = {}
        for source in sorted({rows[i]["source"] for i in idx}):
            j = [k for k, i in enumerate(idx) if rows[i]["source"] == source]
            by_source[source] = auc([values[k] for k in j], [labels[k] for k in j])
        result[split] = {"auc": auc(values, labels), "by_source": by_source, "median_fake_prob": {"real": round(float(np.median([v for v, y in zip(values, labels) if y == 0])), 4), "fake": round(float(np.median([v for v, y in zip(values, labels) if y == 1])), 4)}}
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default=None)
    args = parser.parse_args()
    rows = files()
    results = []
    scorers = [] if args.only else univfd_scorers()
    for model_id, revision, licence in CANDIDATES:
        if args.only and args.only != model_id:
            continue
        try:
            score, labels = hf_scorer(model_id, revision)
            scorers.append((f"{model_id} ({licence}; labels {labels})", score))
        except Exception as error:
            print(f"{model_id}: could not load ({type(error).__name__}: {error})", file=sys.stderr)
    for name, score in scorers:
        print(f"scoring {name}...", flush=True)
        results.append(evaluate(name, score, rows))
        r = results[-1]
        print(f"  calibration AUC {r['calibration']['auc']}  by source {r['calibration']['by_source']}  |  test AUC {r['test']['auc']}  |  {r['seconds_per_image']} s/image", flush=True)
    results.sort(key=lambda r: -(r["calibration"]["auc"] or 0))
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "detector_comparison.json").write_text(json.dumps({"generated_at": time.strftime("%Y-%m-%d %H:%M"), "n_images": len(rows), "results": results}, indent=1))
    print("\n== ranked by CALIBRATION-set AUC (test AUC shown for the record) ==")
    for r in results:
        print(f"{r['calibration']['auc']}  test {r['test']['auc']}  {r['seconds_per_image']}s  {r['name'][:70]}  {r['calibration']['by_source']}")


if __name__ == "__main__":
    main()

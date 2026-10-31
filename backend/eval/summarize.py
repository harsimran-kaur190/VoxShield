"""Turn eval/results/*.json into the small summary the website's Evaluation & Limits page shows, including a
plain-language "where it fails" paragraph written from the numbers, never by hand.

    python -m eval.summarize --main ensemble --baseline baseline --robustness ensemble_jpeg50 ensemble_half ensemble_screenshot

Writes eval/results/summary.json and frontend/src/data/imageEval.json (the page imports the latter). Only test-half
numbers are copied; the calibration half is reported as a size."""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
FRONTEND = ROOT.parent.parent / "frontend" / "src" / "data" / "imageEval.json"

GENERATOR_NAMES = {"stylegan": "StyleGAN faces", "deepfloyd-if": "DeepFloyd IF", "sd-1.4": "Stable Diffusion 1.4", "sd-2.1": "Stable Diffusion 2.1", "sd-xl": "Stable Diffusion XL"}
SOURCE_NAMES = {"faces": "FFHQ photos vs StyleGAN faces (2019)", "elsa": "web photos vs Stable Diffusion / DeepFloyd (2023)", "openfake": "ImageNet & DOCCI photos vs 2025 generators"}


def load(name: str) -> dict:
    return json.loads((RESULTS / f"{name}.json").read_text())


def pct(x: float | None) -> str:
    return "n/a" if x is None else f"{round(x * 100)}%"


def where_it_fails(main: dict, robustness: list[dict]) -> str:
    """Sentences built from the measured numbers: the weakest sources and generators, and the robustness drops."""
    t = main["test"]
    parts = [f"On the held-out test half ({t['n']} images) the detector got {pct(t['accuracy'])} right: it caught {pct(t['recall_fake'])} of the AI images and wrongly flagged {pct(1 - t['specificity_real'])} of the real photos."]
    by_source = sorted(main["test_by_source"].items(), key=lambda kv: kv[1]["accuracy"] or 0)
    weakest_source, m = by_source[0]
    parts.append(f"It is weakest on {SOURCE_NAMES.get(weakest_source, weakest_source)}: {pct(m['accuracy'])} accuracy, AUC {m['auc']}.")
    gens = [(g, v) for g, v in main["test_fake_recall_by_generator"].items() if v["n"] >= 3]
    missed = sorted(gens, key=lambda gv: gv[1]["detected"] / gv[1]["n"])[:3]
    if missed:
        parts.append("The generators it misses most often are " + ", ".join(f"{GENERATOR_NAMES.get(g, g)} ({v['detected']} of {v['n']} caught)" for g, v in missed) + ".")
    drops = []
    for r in robustness:
        delta = (r["test"]["accuracy"] or 0) - (t["accuracy"] or 0)
        label = {"jpeg50": "JPEG recompression at quality 50", "half": "downscaling to half size", "screenshot": "a screenshot-style re-save"}.get(r["transform"], r["transform"])
        drops.append(f"{label} moves accuracy by {delta * 100:+.0f} points (to {pct(r['test']['accuracy'])}, catching {pct(r['test']['recall_fake'])} of fakes)")
    if drops:
        parts.append("After " + "; ".join(drops) + ".")
    inconclusive = sum(v.get("Inconclusive", 0) for v in t["verdicts"].values())
    parts.append(f"{inconclusive} of {t['n']} test images came back Inconclusive by design, where the score sat too close to the decision point.")
    parts.append("None of this covers face swaps or local edits of a real photo, which these detectors were not trained to find.")
    return " ".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--main", required=True)
    parser.add_argument("--baseline", default=None)
    parser.add_argument("--robustness", nargs="*", default=[])
    args = parser.parse_args()
    main_run = load(args.main)
    robustness = [load(n) for n in args.robustness]
    baseline = load(args.baseline) if args.baseline else None

    def slim(run: dict) -> dict:
        t = run["test"]
        return {"name": run["name"], "transform": run.get("transform"), "accuracy": t["accuracy"], "precision_fake": t["precision_fake"], "recall_fake": t["recall_fake"], "specificity_real": t["specificity_real"], "auc": t["auc"], "confusion": t["confusion"], "verdicts": t["verdicts"], "n": t["n"]}

    summary = {
        "generated_at": main_run["generated_at"],
        "detector": main_run["detector"],
        "dataset": {
            "total": main_run["split_sizes"]["calibration"] + main_run["split_sizes"]["test"],
            "calibration": main_run["split_sizes"]["calibration"],
            "test": main_run["split_sizes"]["test"],
            "test_real": main_run["test"]["n_real"],
            "test_fake": main_run["test"]["n_fake"],
            "sources": [
                {"key": "faces", "name": SOURCE_NAMES["faces"], "dataset": "TheKernel01/140k-Real-and-Fake-Faces", "licence": "CC"},
                {"key": "elsa", "name": SOURCE_NAMES["elsa"], "dataset": "elsaEU/ELSA_D3", "licence": "research use"},
                {"key": "openfake", "name": SOURCE_NAMES["openfake"], "dataset": "ComplexDataLab/OpenFake (core, test split)", "licence": "CC BY-NC 4.0"},
            ],
        },
        "main": slim(main_run),
        "baseline": slim(baseline) if baseline else None,
        "by_source": {s: {"name": SOURCE_NAMES.get(s, s), "n": m["n"], "accuracy": m["accuracy"], "recall_fake": m["recall_fake"], "specificity_real": m["specificity_real"], "auc": m["auc"]} for s, m in main_run["test_by_source"].items()},
        "by_generator": {g: {"name": GENERATOR_NAMES.get(g, g), **v} for g, v in main_run["test_fake_recall_by_generator"].items()},
        "robustness": [slim(r) for r in robustness],
        "where_it_fails": where_it_fails(main_run, robustness),
    }
    (RESULTS / "summary.json").write_text(json.dumps(summary, indent=1))
    FRONTEND.parent.mkdir(parents=True, exist_ok=True)
    FRONTEND.write_text(json.dumps(summary, indent=1) + "\n")
    print(summary["where_it_fails"])
    print(f"wrote {RESULTS / 'summary.json'} and {FRONTEND}")


if __name__ == "__main__":
    main()

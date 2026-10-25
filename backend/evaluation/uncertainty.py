"""Bootstrap confidence intervals for a saved evaluation (the examples are resampled with replacement).

    python -m evaluation.uncertainty evaluation/results/test_run1_clean_heldout.json

With a few dozen examples the intervals are wide. They show sampling noise only, not the gap between synthetic
examples and real calls.
"""

import json
import random
import sys
from pathlib import Path


def f1(rows: list[dict], key: str) -> float:
    tp = sum(r["scam"] and r[key] for r in rows)
    fp = sum((not r["scam"]) and r[key] for r in rows)
    fn = sum(r["scam"] and not r[key] for r in rows)
    return 2 * tp / (2 * tp + fp + fn) if tp else 0.0


def recall(rows: list[dict], key: str) -> float:
    positives = [r for r in rows if r["scam"]]
    return sum(r[key] for r in positives) / len(positives) if positives else 0.0


def precision(rows: list[dict], key: str) -> float:
    predicted = [r for r in rows if r[key]]
    return sum(r["scam"] for r in predicted) / len(predicted) if predicted else 0.0


def interval(values: list[float]) -> tuple[float, float]:
    values = sorted(values)
    return values[int(0.025 * len(values))], values[int(0.975 * len(values)) - 1]


def main(path: Path, resamples: int = 5000) -> None:
    rows = json.loads(path.read_text())["predictions"]
    rng = random.Random(0)
    draws = [[rng.choice(rows) for _ in rows] for _ in range(resamples)]
    print(f"{path.name}: n={len(rows)} ({sum(r['scam'] for r in rows)} scam), {resamples} bootstrap resamples, 95% intervals")
    for name, key in (("rules", "rules"), ("nli", "nli")):
        for metric, fn in (("precision", precision), ("recall", recall), ("F1", f1)):
            low, high = interval([fn(d, key) for d in draws])
            print(f"  {name:<5} {metric:<9} {fn(rows, key):.3f}  [{low:.3f}, {high:.3f}]")
    diffs = [f1(d, "nli") - f1(d, "rules") for d in draws]
    low, high = interval(diffs)
    print(f"  F1 difference (nli minus rules) {f1(rows, 'nli') - f1(rows, 'rules'):+.3f}  [{low:+.3f}, {high:+.3f}]")
    print(f"  resamples where nli F1 > rules F1: {sum(d > 0 for d in diffs) / resamples:.1%}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))

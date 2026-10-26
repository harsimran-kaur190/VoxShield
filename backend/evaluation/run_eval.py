"""Compare the rule engine and the NLI model on the labeled scam-intent examples.

    python -m evaluation.run_eval --split dev                # tune on the development set only
    python -m evaluation.run_eval --split test --threshold T # report the held-out set with a frozen threshold

The examples are synthetic (see evaluation/dataset.py). Results describe agreement with those labels, not real calls.
A call counts as "predicted scam" when the detector's risk level is elevated or high. Weak signals, no findings,
and inconclusive all count as "not predicted scam"; inconclusive results are also counted separately.
"""

import argparse
import hashlib
import json
import statistics
import sys
import time
from collections import Counter, defaultdict
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.schemas_analysis import IntentAssessment, TranscriptResult, TranscriptSegment
from app.services.scam_intent import RuleBasedScamIntentAnalyzer
from app.services.scam_nli import DIRECTION_TEXTS, HYPOTHESES, PROTECTIVE_TEXTS, REPORTED_TEXTS, NliModel, NliScamIntentAnalyzer, ScoredTranscript, SentenceScores, Thresholds
from evaluation.dataset import DEV, TEST, Example

HERE = Path(__file__).parent
CACHE = HERE / "cache" / "scores.json"
POSITIVE_RISKS = {"elevated", "high"}


def transcript_for(example: Example) -> TranscriptResult:
    text = example.text
    segment = TranscriptSegment(index=0, start_seconds=0, end_seconds=1, text=text, char_start=0, char_end=len(text))
    return TranscriptResult(status="ok", text=text, language="en", language_probability=0.99, segments=[segment])


def hypothesis_fingerprint() -> str:
    joined = "|".join([text for h in HYPOTHESES for text in h.texts] + list(REPORTED_TEXTS) + list(PROTECTIVE_TEXTS) + list(DIRECTION_TEXTS))
    return hashlib.sha256(("windows-v4-direction|" + joined).encode()).hexdigest()[:12]


def load_cache() -> dict:
    try:
        return json.loads(CACHE.read_text())
    except (OSError, ValueError):
        return {}


def score_examples(analyzer: NliScamIntentAnalyzer, examples: list[Example], cache: dict) -> dict[str, tuple[ScoredTranscript, float]]:
    fingerprint = hypothesis_fingerprint()
    out: dict[str, tuple[ScoredTranscript, float]] = {}
    for example in examples:
        key = f"{fingerprint}:{hashlib.sha256(example.text.encode()).hexdigest()[:12]}"
        if key not in cache:
            started = time.perf_counter()
            scored = analyzer.score(example.text)
            cache[key] = {"seconds": round(time.perf_counter() - started, 3), "sentences": [asdict(s) for s in scored.sentences], "skipped": scored.skipped_sentences}
        entry = cache[key]
        out[example.id] = (ScoredTranscript([SentenceScores(**s) for s in entry["sentences"]], entry["skipped"]), entry["seconds"])
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(cache))
    return out


# ---- metrics -----------------------------------------------------------------------------------------------------


def prf(tp: int, fp: int, fn: int) -> dict:
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": round(precision, 3), "recall": round(recall, 3), "f1": round(f1, 3)}


def evaluate(examples: list[Example], assessments: dict[str, IntentAssessment]) -> dict:
    tp = fp = fn = tn = 0
    risks: Counter[str] = Counter()
    errors: list[dict] = []
    per_kind: dict[str, Counter] = defaultdict(Counter)
    cat_tp = cat_fp = cat_fn = 0
    for example in examples:
        result = assessments[example.id]
        predicted = result.risk in POSITIVE_RISKS
        risks[result.risk] += 1
        if example.scam and predicted:
            tp += 1
        elif example.scam and not predicted:
            fn += 1
            errors.append({"id": example.id, "kind": example.kind, "error": "false_negative", "risk": result.risk})
        elif not example.scam and predicted:
            fp += 1
            errors.append({"id": example.id, "kind": example.kind, "error": "false_positive", "risk": result.risk})
        else:
            tn += 1
        per_kind[example.kind]["correct" if predicted == example.scam else "wrong"] += 1
        found = {i.category for i in result.indicators if i.context == "direct"}
        cat_tp += len(found & example.categories)
        cat_fp += len(found - example.categories)
        cat_fn += len(example.categories - found)
    n = len(examples)
    return {
        "n": n,
        "positives": tp + fn,
        "negatives": tn + fp,
        "confusion": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
        "call_level": {**prf(tp, fp, fn), "accuracy": round((tp + tn) / n, 3)},
        "category_level_micro": {**prf(cat_tp, cat_fp, cat_fn), "tp": cat_tp, "fp": cat_fp, "fn": cat_fn},
        "risk_levels": dict(risks),
        "inconclusive": risks["inconclusive"],
        "per_kind": {k: dict(v) for k, v in sorted(per_kind.items())},
        "errors": errors,
    }


def run_rules(examples: list[Example]) -> tuple[dict[str, IntentAssessment], list[float]]:
    analyzer = RuleBasedScamIntentAnalyzer()
    results, times = {}, []
    for example in examples:
        started = time.perf_counter()
        results[example.id] = analyzer.analyze(transcript_for(example))
        times.append(time.perf_counter() - started)
    return results, times


def run_nli(analyzer: NliScamIntentAnalyzer, examples: list[Example], scored: dict, thresholds: Thresholds):
    return {e.id: analyzer.decide(transcript_for(e), scored[e.id][0], thresholds) for e in examples}


def show(title: str, report: dict) -> None:
    c, cl, cat = report["confusion"], report["call_level"], report["category_level_micro"]
    print(f"\n{title}  (n={report['n']}: {report['positives']} scam, {report['negatives']} not scam)")
    print(f"  confusion   TP={c['tp']} FP={c['fp']} FN={c['fn']} TN={c['tn']}")
    print(f"  call level  precision={cl['precision']} recall={cl['recall']} F1={cl['f1']} accuracy={cl['accuracy']}")
    print(f"  categories  precision={cat['precision']} recall={cat['recall']} F1={cat['f1']} (TP={cat['tp']} FP={cat['fp']} FN={cat['fn']})")
    print(f"  risk levels {report['risk_levels']}  inconclusive={report['inconclusive']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", choices=["dev", "test"], required=True)
    parser.add_argument("--threshold", type=float, help="NLI finding threshold (frozen value for the held-out test set)")
    parser.add_argument("--uncertain", type=float, default=0.3)
    parser.add_argument("--reported", type=float, default=0.5)
    parser.add_argument("--tune", action="store_true", help="grid-search the finding threshold (development set only)")
    parser.add_argument("--errors", action="store_true")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if args.tune and args.split != "dev":
        parser.error("thresholds may only be tuned on the development set")

    examples = DEV if args.split == "dev" else TEST
    settings = Settings()
    analyzer = NliScamIntentAnalyzer(settings, NliModel(settings))
    started = time.perf_counter()
    analyzer.ensure_loaded()
    print(f"model loaded in {time.perf_counter() - started:.1f}s (from local cache if downloaded before)")
    scored = score_examples(analyzer, examples, load_cache())

    rules_results, _ = run_rules(examples)
    report: dict = {"split": args.split, "rules": evaluate(examples, rules_results)}
    show(f"RULES v1.1 on {args.split}", report["rules"])

    if args.tune:
        grid = [round(0.30 + 0.02 * i, 2) for i in range(0, 35)]
        rows = []
        for t in grid:
            result = evaluate(examples, run_nli(analyzer, examples, scored, Thresholds(t, args.uncertain, args.reported)))
            rows.append((t, result["call_level"]["f1"], result["confusion"]))
        print("\nthreshold sweep on the development set (finding threshold -> call-level F1):")
        for t, f1, conf in rows:
            print(f"  {t:.2f}  F1={f1:.3f}  TP={conf['tp']} FP={conf['fp']} FN={conf['fn']}")
        best = max(rows, key=lambda r: (r[1], r[0]))
        print(f"\nbest development F1 {best[1]:.3f} at threshold {best[0]:.2f} (ties resolve to the higher, stricter threshold)")
        args.threshold = best[0]

    threshold = args.threshold if args.threshold is not None else Settings().scam_nli_threshold
    thresholds = Thresholds(threshold, args.uncertain, args.reported)
    nli_results = run_nli(analyzer, examples, scored, thresholds)
    report["nli"] = evaluate(examples, nli_results)
    report["nli"]["thresholds"] = asdict(thresholds)
    seconds = [scored[e.id][1] for e in examples]
    words = [len(e.text.split()) for e in examples]
    report["nli"]["latency_seconds"] = {"mean": round(statistics.mean(seconds), 3), "median": round(statistics.median(seconds), 3), "max": round(max(seconds), 3), "mean_words": round(statistics.mean(words), 1)}
    show(f"NLI ({settings.scam_model_id}) on {args.split}, finding threshold {threshold}", report["nli"])
    print(f"  scoring time per transcript: {report['nli']['latency_seconds']}")

    if args.errors:
        for name in ("rules", "nli"):
            print(f"\n{name} errors:")
            for err in report[name]["errors"]:
                example = next(e for e in examples if e.id == err["id"])
                print(f"  {err['error']:<15} {err['id']} [{err['kind']}] risk={err['risk']}: {example.text[:100]}")
    report["predictions"] = [
        {"id": e.id, "scam": e.scam, "rules": rules_results[e.id].risk in POSITIVE_RISKS, "nli": nli_results[e.id].risk in POSITIVE_RISKS}
        for e in examples
    ]
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

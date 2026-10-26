"""Run the benign/ambiguous/quoted/suspicious set through a detector and report false positives and false negatives.

    python -m evaluation.run_awareness                 # NLI detector (real model, from the local cache)
    python -m evaluation.run_awareness --detector rules

A false positive is a direct finding of medium or high severity (or an elevated/high risk) on a non-suspicious case.
A false negative is a suspicious case whose expected category was not found as a direct finding. Tiny and synthetic:
see evaluation/awareness_cases.py.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.schemas_analysis import TranscriptResult, TranscriptSegment
from app.services.scam_intent import RuleBasedScamIntentAnalyzer
from app.services.scam_nli import NliModel, NliScamIntentAnalyzer
from evaluation.awareness_cases import CASES as DEVELOPMENT_CASES
from evaluation.awareness_holdout import CASES as HOLDOUT_CASES

STRONG = {"medium", "high"}


def transcript_for(text: str) -> TranscriptResult:
    segment = TranscriptSegment(index=0, start_seconds=0, end_seconds=1, text=text, char_start=0, char_end=len(text))
    return TranscriptResult(status="ok", text=text, language="en", language_probability=0.99, segments=[segment])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--detector", choices=["nli", "rules"], default="nli")
    parser.add_argument("--set", choices=["development", "holdout"], default="development", dest="which")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    settings = Settings()
    analyzer = NliScamIntentAnalyzer(settings, NliModel(settings)) if args.detector == "nli" else RuleBasedScamIntentAnalyzer()

    CASES = DEVELOPMENT_CASES if args.which == "development" else HOLDOUT_CASES
    fp, fn, rows = [], [], []
    for case in CASES:
        result = analyzer.analyze(transcript_for(case.text))
        direct = [i for i in result.indicators if i.context == "direct"]
        strong = [i for i in direct if i.severity in STRONG]
        found = sorted({i.category for i in direct})
        if case.kind == "suspicious":
            wrong = case.expect not in found
            if wrong:
                fn.append(case.id)
        else:
            wrong = bool(strong) or result.risk in {"elevated", "high"}
            if wrong:
                fp.append(case.id)
        rows.append({"id": case.id, "kind": case.kind, "risk": result.risk, "direct": found, "strong": sorted({i.category for i in strong}), "suppressed": result.suppressed_mentions, "error": wrong})
        mark = "WRONG" if wrong else "ok   "
        print(f"{mark} {case.id:<4} {case.kind:<10} risk={result.risk:<12} direct={found} expect={case.expect}")
    non = [c for c in CASES if c.kind != "suspicious"]
    sus = [c for c in CASES if c.kind == "suspicious"]
    print(f"\n{args.detector}: false positives {len(fp)}/{len(non)} {fp}; false negatives {len(fn)}/{len(sus)} {fn}")
    if args.out:
        args.out.write_text(json.dumps({"detector": args.detector, "false_positives": fp, "false_negatives": fn, "rows": rows}, indent=1))


if __name__ == "__main__":
    main()

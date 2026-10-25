"""Measure load time, memory, and scoring latency of the scam-intent NLI model on the local machine.

    python scripts/profile_scam_model.py
Run it in a fresh process so the load is a real cold start from the local cache. Uses the synthetic evaluation
transcripts; nothing here is stored.
"""

import resource
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.schemas_analysis import TranscriptResult, TranscriptSegment
from app.services.scam_nli import HYPOTHESES, REPORTED_TEXTS, NliModel, NliScamIntentAnalyzer
from evaluation.dataset import DEV, TEST


def rss_mb() -> float:
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak / (1024 * 1024) if sys.platform == "darwin" else peak / 1024


def transcript(text: str) -> TranscriptResult:
    seg = TranscriptSegment(index=0, start_seconds=0, end_seconds=1, text=text, char_start=0, char_end=len(text))
    return TranscriptResult(status="ok", text=text, language="en", language_probability=0.99, segments=[seg])


def main() -> None:
    settings = Settings()
    print(f"peak RSS before loading the model: {rss_mb():.0f} MB (includes torch and transformers imports)")
    analyzer = NliScamIntentAnalyzer(settings, NliModel(settings))
    import torch  # noqa: F401  (import cost counted separately from load)

    started = time.perf_counter()
    analyzer.ensure_loaded()
    print(f"cold load from local cache: {time.perf_counter() - started:.1f} s | peak RSS after load: {rss_mb():.0f} MB")
    statements = sum(len(h.texts) for h in HYPOTHESES) + len(REPORTED_TEXTS)
    print(f"{statements} statements per premise, 2 premises per sentence, batch {settings.scam_batch_size}, pair budget {settings.scam_max_pairs}")

    analyzer.analyze(transcript("Warm up the model with one short sentence about nothing in particular."))
    texts = [e.text for e in DEV + TEST]
    benign = [e.text for e in DEV + TEST if not e.scam]

    def timed(text: str, repeats: int = 3) -> float:
        runs = []
        for _ in range(repeats):
            started = time.perf_counter()
            analyzer.analyze(transcript(text))
            runs.append(time.perf_counter() - started)
        return statistics.median(runs)

    short = [t for t in texts if 15 <= len(t.split()) <= 35]
    print(f"\nshort transcripts (15-35 words, n={len(short)}): median {statistics.median(timed(t, 1) for t in short):.2f} s")
    for label, words in (("~11 s of speech", 30), ("~1 min of speech", 150), ("~3 min of speech", 450), ("~10 min of speech", 1500)):
        text, i = "", 0
        while len(text.split()) < words:
            text += " " + benign[i % len(benign)]
            i += 1
        sentences = text.count(".") + text.count("?") + text.count("!")
        started = time.perf_counter()
        result = analyzer.analyze(transcript(text.strip()))
        seconds = time.perf_counter() - started
        note = next((l for l in result.limitations if "only the first part" in l), "all sentences analyzed")
        print(f"{label:<18} {len(text.split()):>5} words, ~{sentences} sentences: {seconds:6.1f} s | {note}")
    print(f"\npeak RSS at end: {rss_mb():.0f} MB")


if __name__ == "__main__":
    main()

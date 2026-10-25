"""Measure cold-start and warm latency of the real pipeline, plus memory. Not part of the test suite.

Usage: python scripts/profile_pipeline.py AUDIO_FILE [--warm-runs 3] [--concurrent 2]
Run it in a fresh process so the first request is a true cold start (models not yet loaded).
Nothing here stores audio or transcripts; only timings and sizes are printed.
"""

import argparse
import resource
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.dependencies import get_services
from app.services import audio_validation
from app.config import get_settings


def rss_mb() -> float:
    # ru_maxrss is bytes on macOS, kilobytes on Linux. This is the peak, not the current value.
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak / (1024 * 1024) if sys.platform == "darwin" else peak / 1024


def analyze(path: Path) -> dict:
    services = get_services()
    settings = get_settings()
    size = path.stat().st_size
    metadata = audio_validation.inspect_audio(path, path.name, size, settings)
    started = time.perf_counter()
    report = None
    for event in services.pipeline.run(path, metadata):
        if event["type"] == "report":
            report = event["report"]
    total = time.perf_counter() - started
    assert report is not None
    return {"total": round(total, 2), "status": report.status, "timings": report.timings_seconds, "voice": report.voice.verdict}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("--warm-runs", type=int, default=3)
    parser.add_argument("--concurrent", type=int, default=0)
    args = parser.parse_args()

    services = get_services()
    print(f"models loaded before first request: whisper={services.transcriber.loaded} voice={services.voice.loaded}")
    print(f"cold   {analyze(args.audio)}  peak_rss={rss_mb():.0f} MB")
    for i in range(args.warm_runs):
        print(f"warm {i + 1} {analyze(args.audio)}  peak_rss={rss_mb():.0f} MB")
    if args.concurrent:
        started = time.perf_counter()
        with ThreadPoolExecutor(args.concurrent) as pool:
            results = list(pool.map(analyze, [args.audio] * args.concurrent))
        wall = time.perf_counter() - started
        print(f"{args.concurrent} concurrent: wall={wall:.2f}s each={[r['total'] for r in results]} peak_rss={rss_mb():.0f} MB")
    print(f"threads alive at end: {threading.active_count()}")

"""Check a running VoxShield backend from the outside, the way a visitor (or a load balancer) would.

    python scripts/smoke_test.py https://api.example.com
    python scripts/smoke_test.py http://127.0.0.1:8000 --origin https://app.example.com --audio call.wav

Needs `pip install httpx`. Exits with 1 if any check fails. Nothing is stored; with --audio the file is uploaded for a
real analysis, so use a recording you are happy to send to that server.
"""

import argparse
import io
import struct
import sys
import time
import wave

import httpx

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  ' + detail) if detail else ''}")
    if not ok:
        failures.append(name)
    return ok


def silent_wav(seconds: float = 2.0, rate: int = 16000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(struct.pack("<h", 0) * int(rate * seconds))
    return buffer.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url", help="backend address, without /api/v1")
    parser.add_argument("--origin", help="the web app's address, to check that CORS allows it")
    parser.add_argument("--audio", help="a real recording to run through the full analysis")
    parser.add_argument("--wait-ready", type=int, default=0, metavar="SECONDS", help="wait this long for the models to finish loading")
    args = parser.parse_args()
    api = args.base_url.rstrip("/") + "/api/v1"
    client = httpx.Client(timeout=900)

    r = client.get(f"{api}/health")
    check("liveness: /health answers", r.status_code == 200 and r.json().get("status") == "ok", r.text[:80])
    check("responses are marked uncacheable", r.headers.get("cache-control") == "no-store", r.headers.get("cache-control", "missing"))
    check("responses disable content sniffing", r.headers.get("x-content-type-options") == "nosniff")

    deadline = time.time() + args.wait_ready
    while True:
        ready = client.get(f"{api}/ready")
        if ready.status_code == 200 or time.time() >= deadline:
            break
        time.sleep(3)
    check("readiness: every model is loaded", ready.status_code == 200, ready.text[:120])

    limits = client.get(f"{api}/limits")
    check("limits are published", limits.status_code == 200 and "max_upload_mb" in limits.json())
    models = client.get(f"{api}/models")
    names = [m["name"] for m in models.json().get("models", [])] if models.status_code == 200 else []
    check("model list is published", len(names) == 3, ", ".join(n.split("/")[-1] for n in names))

    docs = client.get(args.base_url.rstrip("/") + "/docs")
    print(f"INFO  interactive docs are {'ON' if docs.status_code == 200 else 'off'} (turn off with VOXSHIELD_DOCS_ENABLED=false on a public server)")

    bad = client.post(f"{api}/uploads/validate", files={"file": ("notes.txt", b"hello", "text/plain")})
    check("a non-audio upload is rejected cleanly", bad.status_code == 415 and bad.json()["detail"]["code"] == "unsupported_extension")
    good = client.post(f"{api}/uploads/validate", files={"file": ("tone.wav", silent_wav(), "audio/wav")})
    check("a valid WAV passes validation without being analyzed", good.status_code == 200 and good.json().get("stored") is False)

    if args.origin:
        pre = client.options(f"{api}/analysis/stream", headers={"origin": args.origin, "access-control-request-method": "POST"})
        check(f"CORS allows {args.origin}", pre.headers.get("access-control-allow-origin") == args.origin, str(pre.headers.get("access-control-allow-origin")))
        evil = client.options(f"{api}/analysis/stream", headers={"origin": "https://evil.example", "access-control-request-method": "POST"})
        check("CORS refuses an unrelated origin", "access-control-allow-origin" not in evil.headers)

    if args.audio:
        with open(args.audio, "rb") as handle:
            started = time.time()
            r = client.post(f"{api}/analysis", files={"file": (args.audio.split("/")[-1], handle.read())})
        report = r.json() if r.status_code == 200 else {}
        check("full analysis returns a report", r.status_code == 200 and report.get("status") in {"complete", "partial"}, f"{time.time() - started:.1f}s, status={report.get('status')}")
        if report:
            check("both assessments are present and separate", {"voice", "intent", "recommendations"} <= set(report) and "overall" not in report)
            check("the server states that nothing is stored", report["privacy"] == {"audio_stored": False, "transcript_stored": False})
            check("no assessment silently failed", report["voice"]["verdict"] != "unavailable" and report["intent"]["risk"] != "unavailable", f"voice={report['voice']['verdict']} intent={report['intent']['risk']}")

    print(f"\n{len(failures)} check(s) failed" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

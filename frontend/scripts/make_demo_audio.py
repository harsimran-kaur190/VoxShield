"""Builds public/demo/stranded-traveller.flac, the voice of the simulated caller on /demo/analysis.

macOS only: each line is spoken by the built-in text-to-speech voice (computer-generated, not a real person) and placed
at its start time from STRANDED_TRAVELLER in src/lib/demoScenario.ts, so the audio stays in step with the transcript.
Keep LINES in sync with that file. Same tools as the Scenario Lab samples (see README).

    python3 scripts/make_demo_audio.py
"""

import subprocess
import tempfile
import wave
from pathlib import Path

VOICE = "Samantha"
RATE = 16000
DURATION = 30.0
LINES = [  # (start seconds, text), as in demoScenario.ts
    (0, "Hello? Hi, it’s me. Sorry, I’m calling from a different phone."),
    (5, "I’m stuck while travelling and my payment is not going through."),
    (10, "Could you send me money immediately?"),
    (15, "I will pay you back once I regain access to my account."),
    (21, "Please act quickly. I can’t really talk for long."),
    (26, "Thank you. I’ll message you the details."),
]
OUT = Path(__file__).resolve().parent.parent / "public" / "demo" / "stranded-traveller.flac"


def main() -> None:
    track = bytearray(int(DURATION * RATE) * 2)  # 16-bit mono silence
    with tempfile.TemporaryDirectory() as tmp:
        for i, (start, text) in enumerate(LINES):
            aiff, wav = Path(tmp, f"{i}.aiff"), Path(tmp, f"{i}.wav")
            subprocess.run(["say", "-v", VOICE, "-o", str(aiff), text], check=True)
            subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{RATE}", "-c", "1", str(aiff), str(wav)], check=True)
            with wave.open(str(wav)) as clip:
                frames = clip.readframes(clip.getnframes())
            offset = int(start * RATE) * 2
            next_start = LINES[i + 1][0] if i + 1 < len(LINES) else DURATION
            if offset + len(frames) > int(next_start * RATE) * 2:
                raise SystemExit(f"Line {i + 1} runs past the next line's start; shorten it or move the start times.")
            track[offset : offset + len(frames)] = frames
        full = Path(tmp, "full.wav")
        with wave.open(str(full), "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(RATE)
            out.writeframes(bytes(track))
        OUT.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["afconvert", "-f", "flac", "-d", f"flac@{RATE}", "-c", "1", str(full), str(OUT)], check=True)
    print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

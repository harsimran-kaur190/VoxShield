"""Voice benchmark under call-like channels, keeping every window score so decision rules can be compared offline.

    python -m evaluation.voice_channels score   DATA_DIR --save evaluation/results/voice/channels_nii.json
    python -m evaluation.voice_channels analyze evaluation/results/voice/channels_nii.json

DATA_DIR is the folder made by `python -m evaluation.voice_benchmark build`. Conditions:

- clean: the clip as built.
- phone: the simulated call channel from voice_benchmark (300-3400 Hz band, 8-bit mu-law, noise at 20 dB SNR).
- ilbc, opus: real narrowband VoIP codecs, encoded at 8 kHz with macOS `afconvert` and decoded back to 16 kHz.

Split: clips are numbered by sentence within each language and source, and real and synthetic clips of the same
sentence share a number. Even numbers are the tuning ("dev") half and odd numbers the reporting ("test") half, so a
rule is never chosen on the clips it is reported on.

What this cannot show is unchanged from voice_benchmark: real phone calls, real rooms, and modern commercial voice
cloning. FLEURS is in the NII model's training data, so the real-voice side is optimistic.
"""

import argparse
import csv
import json
import shutil
import statistics
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path

import numpy as np

from evaluation.voice_benchmark import MANIFEST, _classifier, auc, degrade

CONDITIONS = ("clean", "phone", "ilbc", "opus")
# afconvert (container, codec, extra flags). Opus at 12 kbit/s is a typical low-bandwidth VoIP call.
CODECS = {"ilbc": ("caff", "ilbc", []), "opus": ("caff", "opus", ["-b", "12000"])}


def _codec(path: str, kind: str) -> np.ndarray:
    from app.services.audio_io import load_mono_16k

    container, codec, extra = CODECS[kind]
    with tempfile.TemporaryDirectory() as tmp:
        narrow, coded, back = Path(tmp, "nb.wav"), Path(tmp, "coded"), Path(tmp, "back.wav")
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@8000", "-c", "1", path, str(narrow)], check=True, capture_output=True)
        subprocess.run(["afconvert", "-f", container, "-d", codec, *extra, str(narrow), str(coded)], check=True, capture_output=True)
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(coded), str(back)], check=True, capture_output=True)
        return load_mono_16k(str(back), max_seconds=700)


def channel_audio(path: str, condition: str, seed: int) -> np.ndarray:
    from app.services.audio_io import load_mono_16k

    if condition in CODECS:
        return _codec(path, condition)
    return degrade(load_mono_16k(path, max_seconds=700), "phone" if condition == "phone" else "none", seed)


def _numbered(rows: list[dict]) -> list[dict]:
    """Adds the sentence number: the clip's position within its language and source, as voice_benchmark builds them."""
    seen: dict[tuple[str, str], int] = defaultdict(int)
    out = []
    for row in rows:
        group = (row["lang"], row["source"])
        out.append({**row, "sentence": seen[group]})
        seen[group] += 1
    return out


def score(data_dir: Path, model: str, conditions: tuple[str, ...]) -> dict:
    from app.services.voice_authenticity import band_measurements

    if any(c in CODECS for c in conditions) and not shutil.which("afconvert"):
        raise SystemExit("The ilbc and opus conditions need macOS afconvert.")
    classifier = _classifier(model)
    rows = _numbered(list(csv.DictReader(open(data_dir / MANIFEST))))
    clips = []
    for condition in conditions:
        for index, row in enumerate(rows):
            audio = channel_audio(row["path"], condition, index)
            assessment = classifier.classify(audio)
            clips.append({
                "path": Path(row["path"]).name, "lang": row["lang"], "label": row["label"], "source": row["source"],
                "sentence": row["sentence"], "condition": condition, "verdict": assessment.verdict,
                "windows": [w.fake_score for w in assessment.windows], "band": band_measurements(audio),
            })
        print(f"{condition}: {len(rows)} clips scored")
    return {"model": model, "conditions": list(conditions), "clips": clips}


# ---- offline analysis: no model needed ----

def lean(scores: list[float], threshold: float, band: float, majority: float) -> str:
    """The app's decision rule with the 0.5 cut-off replaced by `threshold` and the borderline band of +/- `band`."""
    if not scores:
        return "none"
    median = statistics.median(scores)
    if threshold - band <= median <= threshold + band:
        return "inconclusive"
    leaning = sum(s >= threshold for s in scores) / len(scores)
    if leaning >= majority:
        return "fake"
    if leaning <= 1 - majority:
        return "real"
    return "inconclusive"


def rates(clips: list[dict], threshold: float, band: float, majority: float = 0.66) -> dict:
    out = {}
    for label in ("real", "fake"):
        group = [c for c in clips if c["label"] == label and c["windows"]]
        verdicts = [lean(c["windows"], threshold, band, majority) for c in group]
        out[label] = {"n": len(group), **{v: (verdicts.count(v) / len(group) if group else 0.0) for v in ("fake", "real", "inconclusive")}}
    return out


def analyze(path: Path) -> None:
    clips = json.loads(path.read_text())["clips"]
    half = {"dev": [c for c in clips if c["sentence"] % 2 == 0], "test": [c for c in clips if c["sentence"] % 2 == 1]}

    print("Band measurements by condition, median [min-max] (dB):")
    for condition in sorted({c["condition"] for c in clips}):
        for key in ("high_to_low_db", "high_lift_db"):
            values = [c["band"][key] for c in clips if c["condition"] == condition and c["band"]]
            print(f"  {condition:6s} {key:15s} {statistics.median(values):7.1f} [{min(values):7.1f} to {max(values):6.1f}]")

    def table(split: str, condition: str, threshold: float, band: float) -> None:
        group = [c for c in half[split] if c["condition"] == condition]
        print(f"  {split:4s} {condition:6s} t={threshold:<5g} band={band:<4g}", end="")
        for lang in ("en", "hi", "pa"):
            real = rates([c for c in group if c["lang"] == lang and c["label"] == "real"], threshold, band)["real"]
            neural = rates([c for c in group if c["lang"] == lang and c["source"] == "mms-tts"], threshold, band)["fake"]
            print(f" | {lang}: real->fake {real['fake']:4.0%} neural caught {neural['fake']:4.0%}", end="")
        print()

    print("\nCurrent rule (t=0.5, band 0.1) on the test half:")
    for condition in CONDITIONS:
        table("test", condition, 0.5, 0.1)

    print("\nThreshold sweep on the dev half (pooled languages): real voices called fake / neural voices caught")
    for condition in CONDITIONS:
        group = [c for c in half["dev"] if c["condition"] == condition]
        for threshold in (0.5, 0.3, 0.2, 0.1, 0.05):
            band = min(0.1, threshold / 2)
            real = rates([c for c in group if c["label"] == "real"], threshold, band)["real"]
            neural = rates([c for c in group if c["source"] == "mms-tts"], threshold, band)["fake"]
            print(f"  {condition:6s} t={threshold:<5g} real->fake {real['fake']:5.1%}  neural caught {neural['fake']:5.1%}")

    print("\nRanking quality (AUC of the median window score, real vs neural), all clips:")
    for condition in CONDITIONS:
        group = [c for c in clips if c["condition"] == condition and c["windows"]]
        line = []
        for lang in ("en", "hi", "pa"):
            r = [statistics.median(c["windows"]) for c in group if c["lang"] == lang and c["label"] == "real"]
            f = [statistics.median(c["windows"]) for c in group if c["lang"] == lang and c["source"] == "mms-tts"]
            line.append(f"{lang} {auc(r, f):.3f}" if r and f else f"{lang} n/a")
        print(f"  {condition:6s} " + "  ".join(line))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["score", "analyze"])
    parser.add_argument("path", type=Path)
    parser.add_argument("--model", default="current")
    parser.add_argument("--conditions", default=",".join(CONDITIONS))
    parser.add_argument("--save", type=Path)
    args = parser.parse_args()
    if args.command == "analyze":
        analyze(args.path)
        return
    report = score(args.path, args.model, tuple(args.conditions.split(",")))
    if args.save:
        args.save.write_text(json.dumps(report, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()

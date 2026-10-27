"""Voice-authenticity benchmark in English, Hindi and Punjabi.

Real speech: read sentences by real people from Google FLEURS (dev split), the same clips the README points to.
Synthetic speech: the same FLEURS sentences spoken by Meta's MMS-TTS neural voices (VITS, one per language), plus macOS
text-to-speech voices. Using the same sentences on both sides means a detector cannot win on content.

    python -m evaluation.voice_benchmark build  DATA_DIR    # download and synthesize (needs network once)
    python -m evaluation.voice_benchmark score  DATA_DIR    # score with the configured voice model
    python -m evaluation.voice_benchmark score  DATA_DIR --model nii-mms-300m

What it cannot show: phone-call audio, noise, or modern commercial voice cloning. FLEURS is also part of the training
data of the NII anti-deepfake models, so their numbers on the real half here are optimistic.
"""

import argparse
import csv
import json
import shutil
import statistics
import subprocess
import tarfile
from pathlib import Path

import numpy as np

LANGS = {"en": ("en_us", "eng"), "hi": ("hi_in", "hin"), "pa": ("pa_in", "pan")}
MAC_VOICES = {"en": ["Samantha", "Daniel", "Karen", "Moira", "Rishi", "Tara", "Aman", "Fred"], "hi": ["Lekha"], "pa": []}
PER_LANG = 40
MANIFEST = "manifest.csv"


def _fleurs(lang: str, out: Path) -> list[tuple[Path, str]]:
    from huggingface_hub import hf_hub_download

    code = LANGS[lang][0]
    tsv = hf_hub_download("google/fleurs", f"data/{code}/dev.tsv", repo_type="dataset")
    archive = hf_hub_download("google/fleurs", f"data/{code}/audio/dev.tar.gz", repo_type="dataset")
    rows = [line.split("\t") for line in Path(tsv).read_text().splitlines()]
    text = {r[1]: r[2] for r in rows if len(r) > 2}
    folder = out / "real" / lang
    folder.mkdir(parents=True, exist_ok=True)
    picked: list[tuple[Path, str]] = []
    seen_sentences: set[str] = set()
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            name = Path(member.name).name
            if not member.isfile() or not name.endswith(".wav") or name not in text or text[name] in seen_sentences:
                continue
            seen_sentences.add(text[name])
            member.name = name
            tar.extract(member, folder, filter="data")
            picked.append((folder / name, text[name]))
            if len(picked) == PER_LANG:
                break
    return picked


def _write_wav(path: Path, samples: np.ndarray, rate: int) -> None:
    import wave

    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(pcm.tobytes())


def _mms(lang: str, sentences: list[str], out: Path) -> list[Path]:
    import torch
    from transformers import AutoTokenizer, VitsModel

    repo = f"facebook/mms-tts-{LANGS[lang][1]}"
    tokenizer, model = AutoTokenizer.from_pretrained(repo), VitsModel.from_pretrained(repo).eval()
    folder = out / "mms" / lang
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for index, sentence in enumerate(sentences):
        torch.manual_seed(index)
        with torch.no_grad():
            wave = model(**tokenizer(sentence, return_tensors="pt")).waveform[0].numpy()
        path = folder / f"mms_{lang}_{index:02d}.wav"
        _write_wav(path, wave, model.config.sampling_rate)
        paths.append(path)
    return paths


def _mac(lang: str, sentences: list[str], out: Path) -> list[Path]:
    voices = MAC_VOICES[lang]
    if not voices or not shutil.which("say"):
        return []
    installed = subprocess.run(["say", "-v", "?"], capture_output=True, text=True).stdout
    voices = [v for v in voices if v in installed]
    folder = out / "mac" / lang
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for index, sentence in enumerate(sentences[:16]):
        voice = voices[index % len(voices)]
        aiff, wav = folder / f"{index}.aiff", folder / f"mac_{lang}_{voice}_{index:02d}.wav"
        subprocess.run(["say", "-v", voice, "-o", str(aiff), sentence], check=True)
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(aiff), str(wav)], check=True)
        aiff.unlink()
        paths.append(wav)
    return paths


def build(out: Path) -> None:
    rows = []
    for lang in LANGS:
        real = _fleurs(lang, out)
        rows += [(str(p), lang, "real", "fleurs") for p, _ in real]
        sentences = [s for _, s in real]
        rows += [(str(p), lang, "fake", "mms-tts") for p in _mms(lang, sentences, out)]
        rows += [(str(p), lang, "fake", "macos-say") for p in _mac(lang, sentences, out)]
        print(lang, {k: sum(1 for r in rows if r[1] == lang and r[3] == k) for k in ("fleurs", "mms-tts", "macos-say")})
    with open(out / MANIFEST, "w", newline="") as f:
        csv.writer(f).writerows([("path", "lang", "label", "source"), *rows])


def auc(real: list[float], fake: list[float]) -> float:
    """Probability that a random fake clip scores higher than a random real one (ties count half)."""
    wins = sum((f > r) + 0.5 * (f == r) for f in fake for r in real)
    return wins / (len(real) * len(fake))


def eer(real: list[float], fake: list[float]) -> tuple[float, float]:
    """Equal error rate: the threshold where real-called-fake and fake-called-real are closest, and that error."""
    best = (1.0, 0.5)
    for t in sorted(set(real + fake)):
        far = sum(r >= t for r in real) / len(real)  # real called fake
        frr = sum(f < t for f in fake) / len(fake)  # fake called real
        best = min(best, (max(far, frr), t))
    return best


def _classifier(model: str):
    from app.config import get_settings
    from app.services.voice_authenticity import build_voice_classifier

    settings = get_settings()
    if model != "current":
        settings = settings.model_copy(update={"voice_model_id": model, "voice_model_revision": None})
    return build_voice_classifier(settings)


def degrade(audio: np.ndarray, kind: str, seed: int) -> np.ndarray:
    """Simulate how a call reaches the user: "phone" keeps only the 300-3400 Hz telephone band, applies 8-bit mu-law
    companding, and adds noise at about 20 dB SNR. Deterministic per clip."""
    if kind == "none":
        return audio
    spectrum = np.fft.rfft(audio)
    freqs = np.fft.rfftfreq(len(audio), 1 / 16000)
    spectrum[(freqs < 300) | (freqs > 3400)] = 0
    band = np.fft.irfft(spectrum, len(audio))
    peak = np.abs(band).max() + 1e-9
    mu = 255.0
    companded = np.sign(band) * np.log1p(mu * np.abs(band / peak)) / np.log1p(mu)
    quantized = np.round(companded * 127) / 127
    expanded = np.sign(quantized) * np.expm1(np.abs(quantized) * np.log1p(mu)) / mu * peak
    noise = np.random.default_rng(seed).standard_normal(len(expanded))
    noise *= np.sqrt(np.mean(expanded**2) / 10 ** (20 / 10)) / (np.sqrt(np.mean(noise**2)) + 1e-12)
    return (expanded + noise).astype(np.float32)


def score(out: Path, model: str, condition: str = "none") -> dict:
    from app.services.audio_io import load_mono_16k

    classifier = _classifier(model)
    rows = list(csv.DictReader(open(out / MANIFEST)))
    results = []
    for index, row in enumerate(rows):
        audio = degrade(load_mono_16k(row["path"], max_seconds=700), condition, index)
        assessment = classifier.classify(audio)
        results.append({**row, "verdict": assessment.verdict, "median": assessment.fake_score_median})
    report = {"model": model, "condition": condition, "groups": {}}
    for lang in LANGS:
        real = [r for r in results if r["lang"] == lang and r["label"] == "real" and r["median"] is not None]
        for source in ("mms-tts", "macos-say"):
            fake = [r for r in results if r["lang"] == lang and r["source"] == source and r["median"] is not None]
            if not real or not fake:
                continue
            rs, fs = [r["median"] for r in real], [r["median"] for r in fake]
            report["groups"][f"{lang}/{source}"] = {
                "real_n": len(rs), "fake_n": len(fs),
                "real_called_fake": sum(r["verdict"] == "model_favors_fake" for r in real) / len(real),
                "real_called_real": sum(r["verdict"] == "model_favors_real" for r in real) / len(real),
                "fake_called_fake": sum(r["verdict"] == "model_favors_fake" for r in fake) / len(fake),
                "fake_called_real": sum(r["verdict"] == "model_favors_real" for r in fake) / len(fake),
                "auc": round(auc(rs, fs), 3),
                "eer": round(eer(rs, fs)[0], 3),
                "median_real": round(statistics.median(rs), 3), "median_fake": round(statistics.median(fs), 3),
            }
    report["clips"] = results
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["build", "score"])
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--model", default="current")
    parser.add_argument("--condition", choices=["none", "phone"], default="none")
    parser.add_argument("--save", type=Path)
    args = parser.parse_args()
    args.data_dir.mkdir(parents=True, exist_ok=True)
    if args.command == "build":
        build(args.data_dir)
        return
    report = score(args.data_dir, args.model, args.condition)
    for group, numbers in report["groups"].items():
        print(f"{group:16s} " + " ".join(f"{k}={v:.2f}" if isinstance(v, float) else f"{k}={v}" for k, v in numbers.items()))
    if args.save:
        args.save.write_text(json.dumps({k: v for k, v in report.items() if k != "clips"} | {"clips": report["clips"]}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()

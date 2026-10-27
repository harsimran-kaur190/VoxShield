"""Score folders of audio with the configured voice model. This is a sanity check, NOT an evaluation.

Usage: python scripts/spot_check.py HUMAN_DIR SYNTHETIC_DIR
Both folders hold audio files you know to be real human speech and known synthetic speech, respectively.
"""

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.services.audio_io import load_mono_16k
from app.services.voice_authenticity import HfAudioClassifier, build_voice_classifier

EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}


def run(label: str, folder: Path, classifier: HfAudioClassifier) -> int:
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() in EXTENSIONS)
    counts: Counter[str] = Counter()
    for path in files:
        result = classifier.classify(load_mono_16k(path))
        counts[result.verdict] += 1
        print(f"  {label:<9} {path.name:<28} {result.verdict:<18} median fake score={result.fake_score_median}")
    print(f"=> {label}: n={len(files)} {dict(counts)}\n")
    return len(files)


if __name__ == "__main__":
    classifier = build_voice_classifier(get_settings())
    n = run("human", Path(sys.argv[1]), classifier) + run("synthetic", Path(sys.argv[2]), classifier)
    print(
        f"NOT AN EVALUATION: n={n} labeled files. Counts only, no accuracy is computed. Estimating accuracy needs hundreds of "
        "labeled clips per class, recorded the way real calls are (phone codecs, noise, several speakers and languages)."
    )

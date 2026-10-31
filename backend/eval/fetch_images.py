"""Build the labelled image test set in eval/images/{real,fake}/ from three public sources, via the Hugging Face
dataset viewer (no login needed). Run once:

    python -m eval.fetch_images

Sources (checked on 2026-10-31):
  * faces     TheKernel01/140k-Real-and-Fake-Faces (licence: CC). Real = FFHQ photos, fake = StyleGAN faces. 60 + 60.
  * elsa      elsaEU/ELSA_D3 (no licence stated; research use). Real = web photos fetched from their original URLs,
              fake = DeepFloyd IF / Stable Diffusion 1.4, 2.1, XL. Reuses the 40 + 40 cached by evaluation/.
  * openfake  ComplexDataLab/OpenFake, "core" config, test split (licence: CC BY-NC 4.0, so research/demo only).
              Real = ImageNet and DOCCI photos; fake = 2025 generators (Midjourney 7, GPT-image 1.5, Flux.2,
              Z-Image, Seedream, Recraft, Veo 3 frames...). 80 + 80, at most 12 per generator for variety.

File names: <source>_<real|fake>_<generator>_<id>.<ext>. The generator is part of the name so results can be broken
down per generator later. Drop your own phone photos into eval/images/real/ as own_real_phone_<n>.jpg to add them."""

import json
import random
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
IMAGES = ROOT / "images"
LEGACY_CACHE = ROOT.parent / "evaluation" / "cache" / "images"
VIEWER = "https://datasets-server.huggingface.co/rows?dataset={dataset}&config={config}&split={split}&offset={offset}&length={length}"

FACES_PER_CLASS = 60
OPENFAKE_PER_CLASS = 80
OPENFAKE_PER_GENERATOR = 12
OPENFAKE_TEST_ROWS = 91_397


def curl(args: list[str]) -> subprocess.CompletedProcess:
    # curl rather than urllib: Python on macOS often has no CA bundle.
    return subprocess.run(["curl", "-sL", "--max-time", "60", *args], capture_output=True, text=True)


def rows(dataset: str, config: str, split: str, offset: int, length: int) -> list[dict]:
    out = curl([VIEWER.format(dataset=dataset, config=config, split=split, offset=offset, length=length)]).stdout
    try:
        return json.loads(out)["rows"]
    except (ValueError, KeyError):
        print(f"  viewer gave no rows for {dataset} offset {offset}", file=sys.stderr)
        return []


def count(label: str, source: str) -> int:
    return len(list((IMAGES / label).glob(f"{source}_{label}_*")))


def download(url: str, target: Path) -> bool:
    curl(["-o", str(target), url])
    if target.exists() and target.stat().st_size > 1000:
        return True
    target.unlink(missing_ok=True)
    return False


def fetch_faces() -> None:
    for offset in range(0, 20_000, 500):
        if min(count("real", "faces"), count("fake", "faces")) >= FACES_PER_CLASS:
            return
        for row in rows("TheKernel01/140k-Real-and-Fake-Faces", "default", "test", offset, 6):
            label = ["real", "fake"][row["row"]["label"]]
            generator = "ffhq" if label == "real" else "stylegan"
            target = IMAGES / label / f"faces_{label}_{generator}_{row['row_idx']}.jpg"
            if count(label, "faces") < FACES_PER_CLASS and not target.exists():
                download(row["row"]["image"]["src"], target)


def copy_legacy_elsa() -> None:
    """The 40 + 40 ELSA_D3 images the earlier check already fetched. Their names carry the generator index g0-g3."""
    generators = {"g0": "deepfloyd-if", "g1": "sd-1.4", "g2": "sd-2.1", "g3": "sd-xl"}
    for path in (LEGACY_CACHE / "diffusion").glob("*"):
        label = "real" if path.name.startswith("real") else "fake"
        stem = path.stem.split("_")  # real_<id> or fake_<id>_g<n>
        generator = generators.get(stem[-1], "web-photo") if label == "fake" else "web-photo"
        target = IMAGES / label / f"elsa_{label}_{generator}_{stem[1]}{path.suffix}"
        if not target.exists():
            shutil.copy(path, target)


def fetch_openfake() -> None:
    per_generator: dict[str, int] = {}
    for path in (IMAGES / "fake").glob("openfake_fake_*"):
        per_generator[path.stem.split("_")[2]] = per_generator.get(path.stem.split("_")[2], 0) + 1
    rng = random.Random(20261031)  # fixed seed: the same sample every run
    offsets = rng.sample(range(0, OPENFAKE_TEST_ROWS - 100), 60)
    for offset in offsets:
        if min(count("real", "openfake"), count("fake", "openfake")) >= OPENFAKE_PER_CLASS:
            return
        for row in rows("ComplexDataLab/OpenFake", "core", "test", offset, 20):
            label, generator = row["row"]["label"], row["row"]["model"].replace("_", "-")
            if label not in ("real", "fake") or count(label, "openfake") >= OPENFAKE_PER_CLASS:
                continue
            if label == "fake" and per_generator.get(generator, 0) >= OPENFAKE_PER_GENERATOR:
                continue
            target = IMAGES / label / f"openfake_{label}_{generator}_{row['row_idx']}.png"
            if not target.exists() and download(row["row"]["image"]["src"], target):
                if label == "fake":
                    per_generator[generator] = per_generator.get(generator, 0) + 1


if __name__ == "__main__":
    for label in ("real", "fake"):
        (IMAGES / label).mkdir(parents=True, exist_ok=True)
    print("faces..."); fetch_faces()
    print("elsa..."); copy_legacy_elsa()
    print("openfake..."); fetch_openfake()
    for label in ("real", "fake"):
        print(label, len(list((IMAGES / label).iterdir())), "images")

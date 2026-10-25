"""Download the exact models VoxShield uses into the Hugging Face cache, so the server can run without network access.

    python scripts/download_models.py            # uses the configured model ids and pinned revisions
    HF_HOME=/path/to/cache python scripts/download_models.py

The Docker image runs this at build time. Afterwards the server can start with HF_HUB_OFFLINE=1.
Only the files each model needs are fetched (safetensors weights, configs, tokenizers), not alternative formats.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from huggingface_hub import snapshot_download

from app.config import get_settings

# Alternative weight formats and training leftovers that the app never loads.
SKIP = ["onnx/*", "*.onnx", "*.h5", "*.msgpack", "*.ot", "*.bin", "*.pt", "*.pth", "*.tflite", "training_args.bin"]


def main() -> None:
    settings = get_settings()
    started = time.perf_counter()

    from faster_whisper.utils import download_model

    print(f"speech-to-text: faster-whisper {settings.whisper_model_size}", flush=True)
    download_model(settings.whisper_model_size, revision=settings.whisper_revision)

    for label, repo, revision in (
        ("voice authenticity", settings.voice_model_id, settings.effective_voice_revision),
        ("scam intent", settings.scam_model_id, settings.effective_scam_revision),
    ):
        print(f"{label}: {repo} @ {(revision or 'latest')[:8]}", flush=True)
        snapshot_download(repo, revision=revision, ignore_patterns=SKIP)

    print(f"done in {time.perf_counter() - started:.0f} s")


if __name__ == "__main__":
    main()

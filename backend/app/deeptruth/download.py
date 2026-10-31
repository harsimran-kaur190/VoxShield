"""Fetch a model file once, over HTTPS, and verify its SHA-256 before it is ever loaded."""

import hashlib
import logging
import ssl
import urllib.request
from pathlib import Path

logger = logging.getLogger("deeptruth.download")


def ensure_file(path: Path, url: str, sha256: str | None) -> Path:
    """Download `url` to `path` if missing, then check the hash. A mismatched file is deleted and an error raised."""
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        logger.info("downloading %s", url)
        # Python's own CA bundle is often missing on macOS; certifi's (installed with huggingface_hub) is used instead.
        context = None
        try:
            import certifi

            context = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            pass
        with urllib.request.urlopen(url, timeout=60, context=context) as response:  # noqa: S310 - fixed https URL from settings
            path.write_bytes(response.read())
    if sha256 and hashlib.sha256(path.read_bytes()).hexdigest() != sha256:
        path.unlink()
        raise ValueError(f"checksum mismatch for {path.name}")
    return path

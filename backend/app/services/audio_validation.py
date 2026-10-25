import re
from pathlib import Path

import mutagen

from app.config import Settings
from app.errors import UploadError
from app.schemas import AudioMetadata

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}
CHUNK_SIZE = 1024 * 1024


def sniff_format(head: bytes) -> str | None:
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:4] == b"fLaC":
        return "flac"
    if head[:4] == b"OggS":
        return "ogg"
    if head[4:8] == b"ftyp":
        return "m4a"
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        return "mp3"
    return None


def safe_display_name(raw: str | None) -> str:
    name = Path(raw or "audio").name
    return re.sub(r"[^\w.\- ]", "_", name)[:120] or "audio"


def check_extension(filename: str | None) -> None:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise UploadError(415, "unsupported_extension", f"Unsupported file type. Allowed: {allowed}.")


def inspect_audio(path: Path, filename: str | None, size: int, settings: Settings) -> AudioMetadata:
    with path.open("rb") as handle:
        detected = sniff_format(handle.read(16))
    if detected is None:
        raise UploadError(415, "unrecognized_audio", "The file contents are not a recognized audio format.")

    try:
        parsed = mutagen.File(path)
    except Exception:
        parsed = None
    if parsed is None or parsed.info is None or not getattr(parsed.info, "length", None):
        raise UploadError(422, "unreadable_audio", "The audio could not be read. It may be corrupted.")

    duration = float(parsed.info.length)
    if duration < settings.min_duration_seconds:
        raise UploadError(422, "too_short", f"Audio must be at least {settings.min_duration_seconds:g} second(s) long.")
    if duration > settings.max_duration_seconds:
        minutes = settings.max_duration_seconds / 60
        raise UploadError(422, "too_long", f"Audio must be no longer than {minutes:g} minutes.")

    return AudioMetadata(
        filename=safe_display_name(filename),
        format=detected,
        size_bytes=size,
        duration_seconds=round(duration, 2),
        sample_rate_hz=getattr(parsed.info, "sample_rate", None),
        channels=getattr(parsed.info, "channels", None),
    )

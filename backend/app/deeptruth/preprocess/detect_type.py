"""Decide whether an upload is an image, an audio clip or a video from its bytes, not its file name or declared MIME type.

Step 1 looks at the first bytes (magic numbers). Step 2, for container formats that can hold either audio or video
(MP4/MOV, Matroska/WebM, AVI, Ogg), opens the file with PyAV and looks at the streams it actually contains."""

from pathlib import Path

import av

from app.deeptruth.schemas import MediaInfo
from app.errors import UploadError
from app.services.audio_validation import safe_display_name, sniff_format

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".opus", ".aac"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
ALL_EXTENSIONS = IMAGE_EXTENSIONS | AUDIO_EXTENSIONS | VIDEO_EXTENSIONS

# Brands written in the "ftyp" box of ISO base media files that mean audio-only M4A.
_AUDIO_FTYP_BRANDS = {b"M4A ", b"M4B ", b"M4P "}


def sniff_image(head: bytes) -> str | None:
    if head[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if head[:2] == b"BM":
        return "bmp"
    if head[:4] in (b"II*\x00", b"MM\x00*"):
        return "tiff"
    if head[4:8] == b"ftyp" and head[8:12] in (b"heic", b"heix", b"mif1", b"heif"):
        return "heic"
    return None


def sniff_container(head: bytes) -> str | None:
    """Formats that need a look inside before they can be called audio or video."""
    if head[:4] == b"RIFF" and head[8:12] == b"AVI ":
        return "avi"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "matroska"  # also WebM
    if head[4:8] == b"ftyp":
        return "m4a" if head[8:12] in _AUDIO_FTYP_BRANDS else "mp4"  # mp4, mov, m4v all share this box
    return None


def check_extension(filename: str | None) -> None:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALL_EXTENSIONS:
        raise UploadError(415, "unsupported_extension", "Unsupported file type. Upload an image, an audio clip or a video.")


def _probe_streams(path: Path) -> dict:
    """What PyAV finds inside a container. A picture embedded as album art is a 'video' stream, so it is ignored."""
    try:
        with av.open(str(path), mode="r") as container:
            # Bit 0x0400 is ffmpeg's AV_DISPOSITION_ATTACHED_PIC (cover art stored as a one-frame video stream).
            video = [s for s in container.streams.video if not int(s.disposition) & 0x0400]
            audio = list(container.streams.audio)
            duration = container.duration / av.time_base if container.duration else None
            info = {"has_video": bool(video), "has_audio": bool(audio), "duration": duration}
            if video:
                info["width"], info["height"] = video[0].codec_context.width, video[0].codec_context.height
                if duration is None and video[0].duration and video[0].time_base:
                    info["duration"] = float(video[0].duration * video[0].time_base)
            if audio:
                info["sample_rate"], info["channels"] = audio[0].codec_context.sample_rate, audio[0].codec_context.channels
                if info["duration"] is None and audio[0].duration and audio[0].time_base:
                    info["duration"] = float(audio[0].duration * audio[0].time_base)
            return info
    except Exception as error:
        raise UploadError(422, "unreadable_media", "The file could not be read. It may be corrupted.") from error


def detect_media(path: Path, filename: str | None, size: int) -> MediaInfo:
    """Classify the saved upload. Raises UploadError when the bytes match no supported format."""
    with path.open("rb") as handle:
        head = handle.read(32)
    name = safe_display_name(filename)

    if image := sniff_image(head):
        return MediaInfo(filename=name, kind="image", format=image, size_bytes=size)

    container = sniff_container(head)
    plain_audio = sniff_format(head)  # VoxShield's own sniffer: wav, flac, ogg, mp3 (and m4a via ftyp)
    if container is None and plain_audio is None:
        raise UploadError(415, "unrecognized_media", "The file contents are not a recognized image, audio or video format.")

    streams = _probe_streams(path)
    fmt = container or plain_audio
    if streams["has_video"]:
        return MediaInfo(
            filename=name, kind="video", format=fmt, size_bytes=size, duration_seconds=_round(streams["duration"]),
            width=streams.get("width"), height=streams.get("height"), has_audio=streams["has_audio"], has_video=True,
            sample_rate_hz=streams.get("sample_rate"), channels=streams.get("channels"),
        )
    if streams["has_audio"]:
        return MediaInfo(
            filename=name, kind="audio", format=fmt, size_bytes=size, duration_seconds=_round(streams["duration"]),
            has_audio=True, has_video=False, sample_rate_hz=streams.get("sample_rate"), channels=streams.get("channels"),
        )
    raise UploadError(422, "no_media_streams", "The file contains neither an audio nor a video stream.")


def _round(value: float | None) -> float | None:
    return round(value, 2) if value is not None else None

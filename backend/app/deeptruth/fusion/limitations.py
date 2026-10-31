"""Report-level limitations generated from the file itself and from how the modules rated their own reliability.

Module-level limitations say what each check could not see. These add what the file's properties mean for every
check at once (size, compression, duration, channels) and name any module whose reading should be discounted. They
are specific sentences with the measured values in them, not boilerplate."""

from app.deeptruth.schemas import MediaInfo, ModuleResult

LOW_RELIABILITY = 0.4
# Below this many bytes per pixel a JPEG or video frame has been compressed hard enough to erase fine traces.
THIN_IMAGE_BYTES_PER_PIXEL = 0.08
LOSSY_AUDIO = {"mp3", "m4a", "ogg", "opus", "aac"}

MODULE_NAMES = {"image": "image", "audio": "voice", "video_frames": "video-frame", "lipsync": "audio-visual sync", "video_temporal": "frame-consistency"}


def file_limitations(media: MediaInfo) -> list[str]:
    items: list[str] = []
    if media.kind == "image":
        if media.width and media.height:
            pixels = media.width * media.height
            if pixels >= 12_000_000:
                items.append(f"Very large image ({media.width}x{media.height}); it was scaled down before the forensic filters, which smooths out the finest traces.")
            if media.format in ("jpeg", "jpg", "webp") and media.size_bytes / pixels < THIN_IMAGE_BYTES_PER_PIXEL:
                items.append(f"Strongly compressed {media.format.upper()} ({media.size_bytes / pixels:.2f} bytes per pixel): compression artefacts can both hide and imitate manipulation traces.")
        if media.format in ("gif", "bmp"):
            items.append(f"{media.format.upper()} files carry no camera metadata and, for GIF, only 256 colours, so EXIF and noise checks say little.")
    if media.kind in ("audio", "video"):
        duration = media.duration_seconds or 0
        if duration and duration < 4:
            items.append(f"Only {duration:g} s of audio: the voice detector prefers at least 4 s and scores one or two windows at most.")
        elif duration > 120:
            items.append(f"{duration / 60:.1f} minutes of audio: only a sample of windows was scored, so a short manipulated passage could sit between them.")
        if media.sample_rate_hz and media.sample_rate_hz < 16_000:
            items.append(f"Audio sample rate is {media.sample_rate_hz} Hz, below the 16 kHz the voice detector was trained on; it was resampled up, which adds no real detail.")
        if media.format in LOSSY_AUDIO:
            items.append(f"Lossy {media.format.upper()} audio: the codec removes exactly the high-frequency detail that distinguishes some synthetic voices.")
        if media.channels and media.channels > 1:
            items.append("Multi-channel audio was mixed down to mono before analysis.")
    if media.kind == "video":
        if media.width and media.height and min(media.width, media.height) < 360:
            items.append(f"Low video resolution ({media.width}x{media.height}): faces are small and frame-level checks lose detail.")
        if media.has_audio is False:
            items.append("The video has no audio track, so the voice and audio-visual sync checks could not run.")
    return items


def module_limitations(modules: list[ModuleResult]) -> list[str]:
    items: list[str] = []
    for module in modules:
        name = MODULE_NAMES.get(module.modality, module.modality)
        if module.status == "unavailable":
            items.append(f"The {name} module did not run ({module.error or 'unknown reason'}); the verdict rests on the others.")
        elif module.reliability < LOW_RELIABILITY:
            items.append(f"The {name} module rated its own reliability at {module.reliability:.0%}, so it carried little weight in the verdict.")
    return items


def generate(media: MediaInfo, modules: list[ModuleResult]) -> list[str]:
    """File-level facts first, then module reliability notes, then each module's own list, without repeats."""
    items = [*file_limitations(media), *module_limitations(modules)]
    for module in modules:
        for item in module.limitations:
            if item not in items:
                items.append(item)
    return items

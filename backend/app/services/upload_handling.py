import tempfile
from pathlib import Path

from fastapi import UploadFile

from app.config import Settings
from app.errors import UploadError
from app.schemas import AudioMetadata
from app.services import audio_validation as validation


async def save_upload(file: UploadFile, settings: Settings, max_mb: int | None = None) -> tuple[tempfile.TemporaryDirectory, Path, int]:
    """Stream an upload into a private temp directory, enforcing the size limit as bytes arrive.

    Shared by the VoxShield audio route and the DeepTruth any-media route (which passes its own, larger `max_mb`).
    The caller must clean up the directory."""
    max_mb = settings.max_upload_mb if max_mb is None else max_mb
    workdir = tempfile.TemporaryDirectory(prefix="voxshield-")
    try:
        target = Path(workdir.name) / "upload.bin"
        size = 0
        with target.open("wb") as out:
            while chunk := await file.read(validation.CHUNK_SIZE):
                size += len(chunk)
                if size > max_mb * 1024 * 1024:
                    raise UploadError(413, "file_too_large", f"File exceeds the {max_mb} MB limit.")
                out.write(chunk)
        if size == 0:
            raise UploadError(422, "empty_file", "The uploaded file is empty.")
    except BaseException:
        workdir.cleanup()
        raise
    return workdir, target, size


async def save_and_validate(
    file: UploadFile, settings: Settings
) -> tuple[tempfile.TemporaryDirectory, Path, AudioMetadata]:
    """Stream an audio upload into a temp directory and validate it. The caller must clean up the directory."""
    validation.check_extension(file.filename)
    workdir, target, size = await save_upload(file, settings)
    try:
        metadata = validation.inspect_audio(target, file.filename, size, settings)
    except BaseException:
        workdir.cleanup()
        raise
    return workdir, target, metadata

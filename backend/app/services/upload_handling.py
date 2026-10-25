import tempfile
from pathlib import Path

from fastapi import UploadFile

from app.config import Settings
from app.errors import UploadError
from app.schemas import AudioMetadata
from app.services import audio_validation as validation


async def save_and_validate(
    file: UploadFile, settings: Settings
) -> tuple[tempfile.TemporaryDirectory, Path, AudioMetadata]:
    """Stream an upload into a temp directory and validate it. The caller must clean up the directory."""
    validation.check_extension(file.filename)
    workdir = tempfile.TemporaryDirectory(prefix="voxshield-")
    try:
        target = Path(workdir.name) / "upload.bin"
        size = 0
        with target.open("wb") as out:
            while chunk := await file.read(validation.CHUNK_SIZE):
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise UploadError(413, "file_too_large", f"File exceeds the {settings.max_upload_mb} MB limit.")
                out.write(chunk)
        if size == 0:
            raise UploadError(422, "empty_file", "The uploaded file is empty.")
        metadata = validation.inspect_audio(target, file.filename, size, settings)
    except BaseException:
        workdir.cleanup()
        raise
    return workdir, target, metadata

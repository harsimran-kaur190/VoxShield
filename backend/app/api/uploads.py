from fastapi import APIRouter, UploadFile

from app.config import get_settings
from app.schemas import ErrorBody, UploadValidationResponse
from app.services.upload_handling import save_and_validate

router = APIRouter(prefix="/uploads", tags=["uploads"])

ERROR_RESPONSES = {code: {"model": ErrorBody} for code in (413, 415, 422)}


@router.post("/validate", response_model=UploadValidationResponse, responses=ERROR_RESPONSES)
async def validate_upload(file: UploadFile) -> UploadValidationResponse:
    workdir, _, audio = await save_and_validate(file, get_settings())
    workdir.cleanup()
    return UploadValidationResponse(
        message="Audio file passed validation. No AI analysis has been run and nothing was stored.",
        audio=audio,
    )

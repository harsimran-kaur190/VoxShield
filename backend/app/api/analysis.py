import json
import threading
from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter, Depends, Form, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from app.config import get_settings
from app.dependencies import get_pipeline
from app.errors import UploadError
from app.schemas import ErrorBody
from app.schemas_analysis import AnalysisReport
from app.services.languages import UnsupportedLanguage, parse_requested_language
from app.services.pipeline import AnalysisPipeline
from app.services.upload_handling import save_and_validate

router = APIRouter(prefix="/analysis", tags=["analysis"])
ERROR_RESPONSES = {code: {"model": ErrorBody} for code in (413, 415, 422, 503)}

_slots: threading.BoundedSemaphore | None = None
_slots_size = 0
_slots_guard = threading.Lock()


def _admission() -> threading.BoundedSemaphore:
    """One shared limit on in-flight analyses. The models serialize inference, so extra requests only queue."""
    global _slots, _slots_size
    size = max(get_settings().max_concurrent_analyses, 1)
    with _slots_guard:
        if _slots is None or size != _slots_size:
            _slots, _slots_size = threading.BoundedSemaphore(size), size
        return _slots


def _admit() -> threading.BoundedSemaphore:
    slots = _admission()
    if not slots.acquire(blocking=False):
        raise UploadError(503, "busy", "VoxShield is busy with other analyses. Please try again in a moment.")
    return slots


def _requested_language(value: str | None) -> str:
    """Checked before anything is read or stored, so a bad value costs nothing. A missing value means auto-detect."""
    try:
        return parse_requested_language(value)
    except UnsupportedLanguage as error:
        raise UploadError(422, "unsupported_language", str(error)) from error


def _final_report(events: Iterator[dict[str, Any]]) -> AnalysisReport:
    report = None
    for event in events:
        if event["type"] == "report":
            report = event["report"]
    assert report is not None
    return report


@router.post("", response_model=AnalysisReport, responses=ERROR_RESPONSES)
async def analyze(file: UploadFile, language: str | None = Form(default=None), pipeline: AnalysisPipeline = Depends(get_pipeline)) -> AnalysisReport:
    """Validate, transcribe, and assess an audio file. Returns one JSON report when everything is done."""
    requested = _requested_language(language)
    slots = _admit()
    try:
        workdir, path, audio = await save_and_validate(file, get_settings())
    except BaseException:
        slots.release()
        raise
    try:
        return await run_in_threadpool(lambda: _final_report(pipeline.run(path, audio, requested)))
    finally:
        workdir.cleanup()
        slots.release()


@router.post("/stream", responses={200: {"content": {"application/x-ndjson": {}}}, **ERROR_RESPONSES})
async def analyze_stream(file: UploadFile, language: str | None = Form(default=None), pipeline: AnalysisPipeline = Depends(get_pipeline)) -> StreamingResponse:
    """Same analysis, streamed as newline-delimited JSON: stage events, then one final report event."""
    requested = _requested_language(language)
    slots = _admit()
    try:
        workdir, path, audio = await save_and_validate(file, get_settings())
    except BaseException:
        slots.release()
        raise
    released = threading.Event()

    def finish() -> None:
        workdir.cleanup()
        if not released.is_set():
            released.set()
            slots.release()

    def lines() -> Iterator[str]:
        try:
            for event in pipeline.run(path, audio, requested):
                if event["type"] == "report":
                    yield json.dumps({"type": "report", "report": json.loads(event["report"].model_dump_json())}) + "\n"
                else:
                    yield json.dumps(event) + "\n"
        except Exception:
            yield json.dumps({"type": "error", "message": "The analysis stopped unexpectedly."}) + "\n"
        finally:
            finish()

    return StreamingResponse(lines(), media_type="application/x-ndjson", background=BackgroundTask(finish))

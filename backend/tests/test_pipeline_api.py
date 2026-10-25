import json
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.dependencies import get_pipeline
from app.main import app
from app.schemas_analysis import AnalysisReport
from app.services.interfaces import ComponentFailure
from app.services.pipeline import AnalysisPipeline
from app.services.scam_intent import RuleBasedScamIntentAnalyzer
from tests.helpers import FAIL, FakeTranscriber, FakeVoice, make_wav, transcript_of, voice_result

client = TestClient(app)
SCAM = "Please read me the one time password we just sent you. Do not tell anyone about this call, and do it right now."


def use(transcriber, voice):
    app.dependency_overrides[get_pipeline] = lambda: AnalysisPipeline(
        get_settings(), transcriber, voice, RuleBasedScamIntentAnalyzer()
    )


@pytest.fixture(autouse=True)
def reset_overrides():
    yield
    app.dependency_overrides.clear()


def post(path="/api/v1/analysis", data=None, name="call.wav"):
    return client.post(path, files={"file": (name, data if data is not None else make_wav(6, amplitude=0.2), "audio/wav")})


def leftover_dirs() -> set[str]:
    return {p.name for p in Path(tempfile.gettempdir()).glob("voxshield-*")}


def test_valid_upload_returns_full_schema_with_both_assessments():
    use(FakeTranscriber(transcript_of(SCAM)), FakeVoice(voice_result("model_favors_real")))
    response = post()
    assert response.status_code == 200
    report = AnalysisReport.model_validate(response.json())
    assert report.status == "complete" and report.errors == []
    assert report.voice.verdict == "model_favors_real"
    assert report.intent.risk == "high" and report.intent.indicators
    assert report.privacy.audio_stored is False and report.privacy.transcript_stored is False
    assert report.recommendations.state == "actions" and report.recommendations.items
    assert set(report.timings_seconds) == {"decode", "transcription", "voice", "intent", "model_load", "total"}


def test_voice_and_intent_are_independent_a_genuine_voice_can_still_carry_a_scam():
    use(FakeTranscriber(transcript_of(SCAM)), FakeVoice(voice_result("model_favors_real")))
    report = post().json()
    assert report["voice"]["verdict"] == "model_favors_real" and report["intent"]["risk"] == "high"
    assert "overall" not in report and "score" not in report


def test_synthetic_voice_with_benign_transcript_is_not_called_a_scam():
    benign = "Hi, your parcel will arrive on Tuesday afternoon between two and four, please be home to sign for it."
    use(FakeTranscriber(transcript_of(benign)), FakeVoice(voice_result("model_favors_fake")))
    report = post().json()
    assert report["voice"]["verdict"] == "model_favors_fake" and report["intent"]["risk"] == "none_detected"


def test_partial_failure_voice_down_but_transcript_and_intent_work():
    use(FakeTranscriber(transcript_of(SCAM)), FakeVoice(error=FAIL))
    report = post().json()
    assert report["status"] == "partial"
    assert report["voice"]["verdict"] == "unavailable" and report["voice"]["fake_score_median"] is None
    assert report["intent"]["risk"] == "high"
    assert [e["component"] for e in report["errors"]] == ["voice"]


def test_partial_failure_transcription_down_but_voice_works():
    use(FakeTranscriber(error=ComponentFailure("transcription_failed", "The audio could not be transcribed.")), FakeVoice(voice_result("model_favors_real")))
    report = post().json()
    assert report["status"] == "partial"
    assert report["transcript"]["status"] == "unavailable" and report["transcript"]["text"] == ""
    assert report["intent"]["risk"] == "unavailable" and report["intent"]["indicators"] == []
    assert report["voice"]["verdict"] == "model_favors_real"


def test_everything_down_reports_failed_without_fabricating_results():
    use(FakeTranscriber(error=FAIL), FakeVoice(error=FAIL))
    report = post().json()
    assert report["status"] == "failed"
    assert report["voice"]["verdict"] == "unavailable" and report["intent"]["risk"] == "unavailable"


def test_unexpected_component_exception_is_contained_and_not_leaked():
    use(FakeTranscriber(transcript_of(SCAM)), FakeVoice(error=RuntimeError("secret internals")))
    response = post()
    assert response.status_code == 200
    assert "secret internals" not in response.text
    assert response.json()["errors"][0]["code"] == "unexpected_error"


def test_silent_audio_gives_inconclusive_results_and_no_invented_evidence():
    from app.schemas_analysis import TranscriptResult
    from app.services.voice_authenticity import HfAudioClassifier

    def loader(_):
        raise AssertionError("must not load")

    use(FakeTranscriber(TranscriptResult(status="no_speech")), HfAudioClassifier(get_settings(), loader=loader))
    report = post(data=make_wav(6)).json()
    assert report["status"] == "complete"
    assert report["transcript"]["status"] == "no_speech"
    assert report["voice"]["verdict"] == "inconclusive"
    assert report["intent"]["risk"] == "inconclusive" and report["intent"]["indicators"] == []


@pytest.mark.parametrize(
    "name, data, status, code",
    [
        ("notes.txt", b"hello", 415, "unsupported_extension"),
        ("fake.wav", b"this is plainly not audio data at all", 415, "unrecognized_audio"),
        ("empty.wav", b"", 422, "empty_file"),
        ("broken.wav", b"RIFF\x00\x00\x00\x00WAVEjunkjunkjunk", 422, "unreadable_audio"),
    ],
)
def test_invalid_uploads_are_rejected_before_any_analysis(name, data, status, code):
    use(FakeTranscriber(error=AssertionError("must not run")), FakeVoice(error=AssertionError("must not run")))
    response = post(data=data, name=name)
    assert response.status_code == status and response.json()["detail"]["code"] == code


def test_oversized_upload_is_rejected(monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_mb", 0)
    assert post().status_code == 413


def test_temp_files_are_removed_after_success_and_after_failure():
    before = leftover_dirs()
    use(FakeTranscriber(transcript_of(SCAM)), FakeVoice(voice_result()))
    post()
    use(FakeTranscriber(error=FAIL), FakeVoice(error=FAIL))
    post()
    post(data=b"not audio", name="x.wav")
    assert leftover_dirs() == before


def test_stream_endpoint_emits_progress_then_the_same_report_schema():
    use(FakeTranscriber(transcript_of(SCAM)), FakeVoice(voice_result("model_favors_real")))
    response = post("/api/v1/analysis/stream")
    assert response.status_code == 200 and response.headers["content-type"].startswith("application/x-ndjson")
    events = [json.loads(line) for line in response.text.splitlines()]
    stages = [(e["stage"], e["state"]) for e in events if e["type"] == "stage"]
    assert stages[0] == ("decode", "running") and ("intent", "done") in stages
    assert events[-1]["type"] == "report"
    AnalysisReport.model_validate(events[-1]["report"])


def test_models_endpoint_reports_ids_and_makes_no_metric_claims():
    body = client.get("/api/v1/models").json()
    assert body["own_evaluation_performed"] is False
    assert any(m["name"].startswith("Gustking/") for m in body["models"])


def test_models_endpoint_exposes_the_spot_check_caveat():
    body = client.get("/api/v1/models").json()
    assert "not an evaluation" in body["voice_spot_check"]


def test_excess_concurrent_analyses_get_a_clear_busy_error_and_slots_are_released(monkeypatch):
    monkeypatch.setattr(get_settings(), "max_concurrent_analyses", 1)
    from app.api import analysis as analysis_api

    use(FakeTranscriber(transcript_of(SCAM)), FakeVoice(voice_result()))
    held = analysis_api._admission()
    assert held.acquire(blocking=False)  # simulate one analysis already running
    try:
        response = post()
        assert response.status_code == 503 and response.json()["detail"]["code"] == "busy"
    finally:
        held.release()
    assert post().status_code == 200  # a failed admission must not leak a slot
    assert post(data=b"not audio", name="x.wav").status_code == 415
    assert post().status_code == 200  # nor must a rejected upload
    assert post("/api/v1/analysis/stream").status_code == 200
    assert post().status_code == 200  # nor a finished stream

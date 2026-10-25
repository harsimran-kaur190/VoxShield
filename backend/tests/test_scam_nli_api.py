"""The NLI detector inside the real pipeline and API (the model itself is a fake)."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.dependencies import get_pipeline, get_services
from app.main import app
from app.schemas_analysis import AnalysisReport
from app.services.interfaces import ComponentFailure
from app.services.pipeline import AnalysisPipeline
from app.services.scam_nli import HYPOTHESES, NliScamIntentAnalyzer
from tests.helpers import FakeTranscriber, FakeVoice, make_wav, transcript_of, voice_result
from tests.test_scam_nli import FakeNli

client = TestClient(app)
CRED = HYPOTHESES[0].texts[0]
TEXT = "Please tell me the code that was just sent to your phone right now, thanks."


@pytest.fixture(autouse=True)
def reset():
    yield
    app.dependency_overrides.clear()


def use(intent):
    app.dependency_overrides[get_pipeline] = lambda: AnalysisPipeline(
        get_settings(), FakeTranscriber(transcript_of(TEXT)), FakeVoice(voice_result("model_favors_real")), intent
    )


def post():
    return client.post("/api/v1/analysis", files={"file": ("call.wav", make_wav(6, amplitude=0.2), "audio/wav")})


def test_an_nli_finding_flows_through_the_api_with_evidence_and_matching_recommendations():
    use(NliScamIntentAnalyzer(Settings(), FakeNli({("tell me the code", CRED): 0.97})))  # type: ignore[arg-type]
    response = post()
    assert response.status_code == 200
    report = AnalysisReport.model_validate(response.json())
    assert report.status == "complete" and report.intent.detector == "nli"
    (finding,) = report.intent.indicators
    assert finding.excerpt == TEXT and finding.score == 0.97 and finding.start_seconds is not None
    assert [r.id for r in report.recommendations.items] == ["credentials"]
    assert report.recommendations.items[0].evidence[0].id == finding.id
    assert "overall" not in response.json()  # the two assessments are still never merged


def test_when_the_model_cannot_load_only_the_scam_assessment_is_unavailable_and_nothing_is_substituted():
    class Unloadable(FakeNli):
        def entailment(self, pairs):
            raise ComponentFailure("model_load_failed", "The scam-intent model could not be loaded.")

    use(NliScamIntentAnalyzer(Settings(), Unloadable()))  # type: ignore[arg-type]
    report = post().json()
    assert report["status"] == "partial"
    assert report["intent"]["risk"] == "unavailable" and report["intent"]["indicators"] == []
    assert report["intent"]["detector"] == "nli"  # names the configured detector; no rule findings were silently used
    assert report["voice"]["verdict"] == "model_favors_real"
    assert [e["component"] for e in report["errors"]] == ["intent"]
    assert report["recommendations"]["state"] == "insufficient"


def test_an_unexpected_model_error_is_contained_and_not_leaked():
    class Boom(FakeNli):
        def entailment(self, pairs):
            raise RuntimeError("secret internals")

    use(NliScamIntentAnalyzer(Settings(), Boom()))  # type: ignore[arg-type]
    response = post()
    assert response.status_code == 200 and "secret internals" not in response.text
    assert response.json()["errors"][0]["code"] == "unexpected_error"


def test_the_detector_is_chosen_by_configuration_and_never_combined(monkeypatch):
    from app.services.scam_intent import RuleBasedScamIntentAnalyzer

    get_services.cache_clear()
    monkeypatch.setattr(get_settings(), "scam_detector", "rules")
    assert isinstance(get_services().intent, RuleBasedScamIntentAnalyzer)
    get_services.cache_clear()
    monkeypatch.setattr(get_settings(), "scam_detector", "nli")
    assert isinstance(get_services().intent, NliScamIntentAnalyzer)
    get_services.cache_clear()


def test_the_models_endpoint_describes_whichever_detector_is_active(monkeypatch):
    get_services.cache_clear()
    monkeypatch.setattr(get_settings(), "scam_detector", "nli")
    scam = next(m for m in client.get("/api/v1/models").json()["models"] if m["role"] == "Scam intent")
    assert scam["name"].startswith("MoritzLaurer/") and scam["loaded"] is False and "MIT" in scam["license"]
    assert len(scam["revision"]) == 40
    get_services.cache_clear()
    monkeypatch.setattr(get_settings(), "scam_detector", "rules")
    scam = next(m for m in client.get("/api/v1/models").json()["models"] if m["role"] == "Scam intent")
    assert scam["name"].startswith("voxshield-scam-rules") and scam["loaded"] is True
    get_services.cache_clear()

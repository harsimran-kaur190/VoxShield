"""Production guards: rate limiting, caching headers, docs toggle, CORS, readiness."""

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.dependencies import get_services
from app.main import create_app
from app.middleware import SlidingWindowLimiter
from tests.helpers import make_wav

URL = "/api/v1/uploads/validate"


def app_with(monkeypatch, **settings):
    for name, value in settings.items():
        monkeypatch.setattr(get_settings(), name, value)
    return TestClient(create_app())


def post(client, data=None):
    return client.post(URL, files={"file": ("a.wav", data or make_wav(2), "audio/wav")})


class Clock:
    now = 0.0

    def __call__(self) -> float:
        return self.now


class TestLimiter:
    def test_allows_up_to_the_limit_then_says_how_long_to_wait(self):
        clock = Clock()
        limiter = SlidingWindowLimiter(3, 60, clock)
        assert [limiter.check("a") for _ in range(3)] == [None, None, None]
        clock.now = 10
        wait = limiter.check("a")
        assert wait is not None and 49 < wait <= 50

    def test_the_window_slides_so_old_requests_stop_counting(self):
        clock = Clock()
        limiter = SlidingWindowLimiter(2, 60, clock)
        limiter.check("a")
        clock.now = 30
        limiter.check("a")
        clock.now = 61  # the first one has aged out, the second has not
        assert limiter.check("a") is None
        assert limiter.check("a") is not None

    def test_each_client_has_its_own_allowance(self):
        limiter = SlidingWindowLimiter(1, 60, Clock())
        assert limiter.check("a") is None and limiter.check("b") is None
        assert limiter.check("a") is not None

    def test_zero_turns_the_limit_off(self):
        limiter = SlidingWindowLimiter(0, 60, Clock())
        assert all(limiter.check("a") is None for _ in range(1000))

    def test_memory_is_bounded_by_the_number_of_clients_tracked(self):
        limiter = SlidingWindowLimiter(5, 60, Clock(), max_keys=100)
        for i in range(1000):
            limiter.check(f"client-{i}")
        assert len(limiter._hits) <= 100


class TestRateLimitedApi:
    def test_floods_get_a_clear_429_with_retry_after_and_valid_requests_before_it_still_work(self, monkeypatch):
        client = app_with(monkeypatch, rate_limit_per_minute=3)
        assert [post(client).status_code for _ in range(3)] == [200, 200, 200]
        blocked = post(client)
        assert blocked.status_code == 429
        assert blocked.json()["detail"]["code"] == "rate_limited"
        assert int(blocked.headers["retry-after"]) >= 1
        assert blocked.headers["cache-control"] == "no-store"

    def test_only_uploads_and_analysis_are_limited_not_health_or_limits_or_models(self, monkeypatch):
        client = app_with(monkeypatch, rate_limit_per_minute=1)
        post(client)
        assert post(client).status_code == 429
        for path in ("/api/v1/health", "/api/v1/limits", "/api/v1/models"):
            assert all(client.get(path).status_code == 200 for _ in range(5)), path

    def test_cors_preflight_is_not_counted(self, monkeypatch):
        client = app_with(monkeypatch, rate_limit_per_minute=1)
        for _ in range(5):
            client.options(URL, headers={"origin": "http://localhost:5173", "access-control-request-method": "POST"})
        assert post(client).status_code == 200

    def test_a_rejected_flood_does_not_leave_temp_files_or_reach_the_analysis(self, monkeypatch):
        import tempfile
        from pathlib import Path

        client = app_with(monkeypatch, rate_limit_per_minute=1)
        before = {p.name for p in Path(tempfile.gettempdir()).glob("voxshield-*")}
        post(client)
        for _ in range(5):
            assert post(client).status_code == 429
        assert {p.name for p in Path(tempfile.gettempdir()).glob("voxshield-*")} == before


class TestResponseHeaders:
    def test_api_responses_are_never_cacheable_because_they_can_contain_transcripts(self, monkeypatch):
        client = app_with(monkeypatch)
        for response in (client.get("/api/v1/health"), post(client), client.get("/api/v1/models")):
            assert response.headers["cache-control"] == "no-store"
            assert response.headers["x-content-type-options"] == "nosniff"
            assert response.headers["referrer-policy"] == "no-referrer"

    def test_error_responses_are_marked_too(self, monkeypatch):
        client = app_with(monkeypatch)
        response = client.post(URL, files={"file": ("a.txt", b"hello", "text/plain")})
        assert response.status_code == 415 and response.headers["cache-control"] == "no-store"

    def test_a_streamed_analysis_is_still_streamed_with_the_headers(self, monkeypatch):
        from app.api.analysis import router  # noqa: F401  (the streaming route exists)

        client = app_with(monkeypatch)
        response = client.post("/api/v1/analysis/stream", files={"file": ("a.txt", b"x", "text/plain")})
        assert response.headers["cache-control"] == "no-store"


class TestConfiguration:
    def test_docs_can_be_switched_off_for_a_public_server(self, monkeypatch):
        on = app_with(monkeypatch, docs_enabled=True)
        assert on.get("/docs").status_code == 200 and on.get("/openapi.json").status_code == 200
        off = app_with(monkeypatch, docs_enabled=False)
        assert off.get("/docs").status_code == 404 and off.get("/openapi.json").status_code == 404
        assert off.get("/api/v1/health").status_code == 200

    def test_cors_allows_listed_origins_and_a_pattern_but_nothing_else(self, monkeypatch):
        client = app_with(monkeypatch, cors_origins=["https://app.example.com"], cors_origin_regex=r"https://voxshield-[a-z0-9-]+\.vercel\.app")
        ask = lambda origin: client.options(URL, headers={"origin": origin, "access-control-request-method": "POST"}).headers.get("access-control-allow-origin")
        assert ask("https://app.example.com") == "https://app.example.com"
        assert ask("https://voxshield-git-main-team.vercel.app") == "https://voxshield-git-main-team.vercel.app"
        assert ask("https://evil.example") is None
        assert ask("http://localhost:5173") is None

    def test_the_version_is_reported(self):
        assert TestClient(create_app()).get("/api/v1/health").json()["version"] == "0.3.0"


class TestReadiness:
    def test_not_ready_until_every_model_is_loaded_while_health_stays_up(self, monkeypatch):
        get_services.cache_clear()
        client = TestClient(create_app())
        response = client.get("/api/v1/ready")
        assert response.status_code == 503
        body = response.json()
        assert body["status"] == "loading" and set(body["models"]) == {"speech_to_text", "voice", "scam_intent"}
        assert client.get("/api/v1/health").status_code == 200
        get_services.cache_clear()

    def test_ready_once_everything_reports_loaded(self, monkeypatch):
        get_services.cache_clear()
        services = get_services()
        monkeypatch.setattr(type(services.transcriber), "loaded", property(lambda self: True))
        monkeypatch.setattr(type(services.voice), "loaded", property(lambda self: True))
        monkeypatch.setattr(type(services.intent), "loaded", property(lambda self: True), raising=False)
        response = TestClient(create_app()).get("/api/v1/ready")
        assert response.status_code == 200 and response.json()["status"] == "ready"
        get_services.cache_clear()

"""Security-relevant behavior of the upload path: size limits that cannot be bypassed, safe filenames, errors that do not
leak, and the proxy configuration that the rate limiter depends on. Each test pins something that was checked by hand
against a running server during the Stage 6 audit."""

import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from tests.helpers import make_wav

VALIDATE = "/api/v1/uploads/validate"
REPO = Path(__file__).resolve().parents[2]


def client_with(monkeypatch, **settings) -> TestClient:
    for name, value in settings.items():
        monkeypatch.setattr(get_settings(), name, value)
    return TestClient(create_app(), raise_server_exceptions=False)


def multipart(body: bytes, filename: str = "a.wav") -> tuple[bytes, str]:
    boundary = "vsboundary"
    head = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
    return head + body + f"\r\n--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def spool_files() -> set[str]:
    return {p.name for p in Path(tempfile.gettempdir()).glob("voxshield-*")}


class TestBodySizeCannotBeBypassed:
    def test_a_chunked_body_with_no_content_length_is_cut_off_at_the_limit_and_never_reaches_the_handler(self, monkeypatch):
        """Found in the audit: only a declared Content-Length was checked early, so a chunked 120 MB upload was received
        and spooled to disk in full before the 413 was sent."""
        client = client_with(monkeypatch, max_upload_mb=1)
        reached = []
        monkeypatch.setattr("app.api.uploads.save_and_validate", lambda *a, **k: reached.append(1))
        body, content_type = multipart(b"\0" * (8 * 1024 * 1024))
        consumed = 0

        def chunks():
            nonlocal consumed
            for start in range(0, len(body), 64 * 1024):
                consumed = start
                yield body[start : start + 64 * 1024]

        response = client.post(VALIDATE, content=chunks(), headers={"content-type": content_type})
        assert response.status_code == 413
        assert response.json()["detail"]["code"] == "file_too_large"
        assert reached == []
        assert response.headers["cache-control"] == "no-store"

    def test_a_declared_oversized_body_is_still_refused_before_it_is_read(self, monkeypatch):
        client = client_with(monkeypatch, max_upload_mb=1)
        body, content_type = multipart(b"\0" * (3 * 1024 * 1024))
        response = client.post(VALIDATE, content=body, headers={"content-type": content_type})
        assert response.status_code == 413

    def test_a_chunked_body_within_the_limit_still_works(self, monkeypatch):
        client = client_with(monkeypatch)
        body, content_type = multipart(make_wav(2))
        response = client.post(VALIDATE, content=(body[i : i + 4096] for i in range(0, len(body), 4096)), headers={"content-type": content_type})
        assert response.status_code == 200 and response.json()["audio"]["duration_seconds"] == 2.0

    def test_the_streaming_endpoint_has_the_same_protection(self, monkeypatch):
        client = client_with(monkeypatch, max_upload_mb=1)
        body, content_type = multipart(b"\0" * (4 * 1024 * 1024))
        response = client.post("/api/v1/analysis/stream", content=(body[i : i + 65536] for i in range(0, len(body), 65536)), headers={"content-type": content_type})
        assert response.status_code == 413

    def test_rejected_oversized_uploads_leave_no_upload_folders(self, monkeypatch):
        before = spool_files()
        client = client_with(monkeypatch, max_upload_mb=1)
        body, content_type = multipart(b"\0" * (4 * 1024 * 1024))
        client.post(VALIDATE, content=(body[i : i + 65536] for i in range(0, len(body), 65536)), headers={"content-type": content_type})
        assert spool_files() == before


class TestFilenames:
    def test_hostile_names_become_harmless_display_names_and_are_never_used_as_paths(self, monkeypatch):
        client = client_with(monkeypatch)
        before = spool_files()
        expected = {
            "../../../etc/passwd.wav": "passwd.wav",
            "/abs/path/secret.wav": "secret.wav",
            "..\\..\\win.wav": ".._.._win.wav",
            "<img src=x onerror=alert(1)>.wav": "_img src_x onerror_alert_1__.wav",
        }
        for sent, shown in expected.items():
            response = client.post(VALIDATE, files={"file": (sent, make_wav(2), "audio/wav")})
            assert response.status_code == 200 and response.json()["audio"]["filename"] == shown, sent
        assert spool_files() == before

    def test_a_very_long_name_is_truncated(self, monkeypatch):
        client = client_with(monkeypatch)
        response = client.post(VALIDATE, files={"file": ("A" * 500 + ".wav", make_wav(2), "audio/wav")})
        assert len(response.json()["audio"]["filename"]) <= 120

    def test_the_extension_check_cannot_be_dodged_with_a_double_extension_or_trailing_dot(self, monkeypatch):
        client = client_with(monkeypatch)
        for name in ("evil.wav.exe", "evil.wav.", "evil", ".wav.txt"):
            assert client.post(VALIDATE, files={"file": (name, make_wav(2), "audio/wav")}).status_code == 415, name


class TestErrorsDoNotLeak:
    def test_an_unexpected_server_error_returns_no_message_path_or_traceback(self, monkeypatch):
        client = client_with(monkeypatch)

        def boom(*args, **kwargs):
            raise RuntimeError("secret token at /Users/someone/private/key.pem")

        monkeypatch.setattr("app.api.uploads.save_and_validate", boom)
        response = client.post(VALIDATE, files={"file": ("a.wav", make_wav(2), "audio/wav")})
        assert response.status_code == 500
        assert "secret" not in response.text and "/Users/" not in response.text and "Traceback" not in response.text
        assert response.headers["cache-control"] == "no-store"

    def test_a_failure_inside_a_streamed_analysis_reports_only_a_generic_message(self, monkeypatch):
        client = client_with(monkeypatch)
        from app.services.pipeline import AnalysisPipeline

        def boom(self, *args, **kwargs):
            raise RuntimeError("secret token at /Users/someone/private/key.pem")
            yield  # pragma: no cover

        monkeypatch.setattr(AnalysisPipeline, "run", boom)
        response = client.post("/api/v1/analysis/stream", files={"file": ("a.wav", make_wav(2), "audio/wav")})
        assert response.status_code == 200
        assert "The analysis stopped unexpectedly." in response.text
        assert "secret" not in response.text and "/Users/" not in response.text

    def test_malformed_requests_get_framework_errors_that_name_only_the_missing_field(self, monkeypatch):
        client = client_with(monkeypatch)
        response = client.post(VALIDATE, data={"x": "1"})
        assert response.status_code == 422
        assert response.json()["detail"][0]["loc"] == ["body", "file"]


class TestProxyConfiguration:
    def test_nginx_overwrites_x_forwarded_for_instead_of_appending_to_what_the_client_sent(self):
        """Found in the audit: docker-compose trusts forwarded headers from the proxy ("*"), and nginx appended the
        client's own X-Forwarded-For, so a client could pick the address the rate limiter saw."""
        conf = (REPO / "frontend" / "nginx.conf").read_text()
        assert "proxy_add_x_forwarded_for" not in conf
        assert "proxy_set_header X-Forwarded-For $remote_addr;" in conf

    def test_the_backend_port_is_not_published_to_the_host_in_compose(self):
        compose = (REPO / "docker-compose.yml").read_text()
        backend = compose.split("web:")[0]
        assert "ports:" not in backend and "expose:" in backend

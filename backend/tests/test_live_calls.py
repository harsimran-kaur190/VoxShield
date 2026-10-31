"""Live Call Protection: rooms, signaling, incoming-audio analysis and alerts. The models are stubbed; the pipeline,
scam-intent rules, recommendations and alert logic are the real ones."""

import tempfile
import threading
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api import analysis as analysis_api
from app.api.calls import get_registry
from app.config import get_settings
from app.dependencies import get_pipeline
from app.main import app
from app.schemas_analysis import IntentAssessment, IntentIndicator, RecommendationPlan, TranscriptResult, TranscriptSegment
from app.services.live_calls import AlertTracker, CallRegistry, IncomingAudio, FrameRejected, TranscriptCommitter, ice_servers, valid_room_id
from app.services.pipeline import AnalysisPipeline
from app.services.scam_intent import RuleBasedScamIntentAnalyzer
from tests.helpers import FakeTranscriber, FakeVoice, transcript_of, voice_result

client = TestClient(app)
SCAM = "Please read me the one time password we just sent you. Do not tell anyone about this call, and do it right now."


class CountingTranscriber(FakeTranscriber):
    def __init__(self, result):
        super().__init__(result)
        self.calls = 0

    def transcribe(self, audio, language=None):
        self.calls += 1
        return super().transcribe(audio, language)


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    get_registry.cache_clear()
    settings = get_settings()
    monkeypatch.setattr(settings, "call_max_ahead_seconds", 1000.0)  # tests send audio faster than real time
    yield
    app.dependency_overrides.clear()
    get_registry().close_all()
    get_registry.cache_clear()


def use(transcriber, voice=None):
    app.dependency_overrides[get_pipeline] = lambda: AnalysisPipeline(
        get_settings(), transcriber, voice or FakeVoice(voice_result("inconclusive")), RuleBasedScamIntentAnalyzer()
    )


def tone(seconds: float, amplitude: float = 0.2) -> bytes:
    t = np.arange(int(16000 * seconds)) / 16000
    return (np.sin(2 * np.pi * 220 * t) * amplitude * 32767).astype("<i2").tobytes()


def new_room() -> str:
    response = client.post("/api/v1/calls")
    assert response.status_code == 201
    return response.json()["room_id"]


def join(ws, **extra):
    ws.send_json({"type": "join", "consent": True, **extra})
    welcome = ws.receive_json()
    assert welcome["type"] == "welcome"
    return welcome


def receive_until(ws, kind, limit=20):
    seen = []
    for _ in range(limit):
        message = ws.receive_json()
        seen.append(message)
        if message["type"] == kind:
            return message, seen
    raise AssertionError(f"no {kind} in {seen}")


def test_create_room_returns_an_unguessable_id():
    body = client.post("/api/v1/calls").json()
    assert valid_room_id(body["room_id"]) and len(body["room_id"]) >= 16
    assert body["max_participants"] == 2


def test_unknown_room_is_refused():
    with client.websocket_connect("/api/v1/calls/doesnotexist123/ws") as ws:
        assert ws.receive_json()["code"] == "room_not_found"


def test_joining_requires_consent_to_analysis():
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as ws:
        ws.send_json({"type": "join"})
        assert ws.receive_json()["code"] == "bad_join"


def test_other_origins_cannot_open_a_call_socket():
    room = new_room()
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/v1/calls/{room}/ws", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_json()


def test_two_participants_are_introduced_and_signaling_is_relayed_and_a_third_is_refused():
    use(FakeTranscriber(transcript_of("hello")))
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as a:
        welcome_a = join(a)
        assert welcome_a["peer"] is None and welcome_a["ice_servers"] and welcome_a["analysis"]["enabled"]
        with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b:
            welcome_b = join(b)
            assert welcome_b["peer"]["id"] == welcome_a["participant_id"]
            assert a.receive_json() == {"type": "peer-joined", "peer_id": welcome_b["participant_id"]}

            a.send_json({"type": "signal", "data": {"kind": "offer", "sdp": "v=0"}})
            assert b.receive_json() == {"type": "signal", "from": welcome_a["participant_id"], "data": {"kind": "offer", "sdp": "v=0"}}
            b.send_json({"type": "signal", "data": {"kind": "bogus"}})  # invalid signals are dropped, not relayed
            b.send_json({"type": "signal", "data": {"kind": "answer", "sdp": "v=0 answer"}})
            assert a.receive_json()["data"]["kind"] == "answer"

            with client.websocket_connect(f"/api/v1/calls/{room}/ws") as c:
                c.send_json({"type": "join", "consent": True})
                assert c.receive_json()["code"] == "room_full"


def test_incoming_audio_is_analysed_and_alerts_reach_only_the_listener():
    use(FakeTranscriber(transcript_of(SCAM)))
    room, other_room = new_room(), new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as a, client.websocket_connect(f"/api/v1/calls/{other_room}/ws") as stranger:
        join(a)
        join(stranger)
        with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b:
            join(b)
            a.receive_json()  # peer-joined
            for _ in range(6):  # B's browser forwards the audio it receives from A
                b.send_bytes(tone(1))
            analysis, _ = receive_until(b, "analysis")
            assert analysis["intent"]["risk"] == "high"
            assert analysis["window"][1] == pytest.approx(5, abs=1.1)  # analysed after one step of new audio
            alert, _ = receive_until(b, "alert")
            alert = alert["alert"]
            assert alert["kind"] == "scam" and alert["level"] == "high"
            assert "credential_request" in alert["tactics"]
            assert any("password" in e["excerpt"].lower() for e in alert["evidence"])
            assert alert["voice"]["verdict"] == "inconclusive"  # reported separately, never folded into the risk
            assert alert["actions"] and alert["limitations"] and alert["created_at"]

            # Nothing about B's analysis reached A or another room: the next message each gets is the reply to a ping.
            for ws in (a, stranger):
                ws.send_json({"type": "ping"})
                assert ws.receive_json() == {"type": "pong"}


def test_overlapping_windows_do_not_repeat_the_same_alert():
    use(FakeTranscriber(transcript_of(SCAM)))
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b:
        join(b)
        for _ in range(6):
            b.send_bytes(tone(1))
        receive_until(b, "alert")
        receive_until(b, "analysis-status")  # back to listening
        for _ in range(6):
            b.send_bytes(tone(1))
        second, seen = receive_until(b, "analysis")
        b.send_json({"type": "ping"})
        _, rest = receive_until(b, "pong")
        assert not [m for m in seen + rest if m["type"] == "alert"]


def test_the_last_sentence_before_a_pause_is_released_not_held_forever():
    committer = TranscriptCommitter(window_seconds=12, step_seconds=5)
    segments = [{"start": 0.0, "end": 4.0, "text": "First sentence."}, {"start": 6.0, "end": 11.5, "text": "Read me the code now."}]
    assert [s["text"] for s in committer.commit(segments, window_end=12.0, window_start=0.0)] == ["First sentence."]
    assert committer.held is not None  # cut at the window edge, so held for the next window
    assert [s["text"] for s in committer.release_held()] == ["Read me the code now."]
    assert committer.held is None and committer.release_held() == []
    # a later window does not repeat the released sentence
    assert committer.commit([{"start": 6.0, "end": 11.5, "text": "Read me the code now."}], window_end=17.0, window_start=5.0) == []


def test_silence_is_not_sent_to_the_models():
    transcriber = CountingTranscriber(transcript_of(SCAM))
    use(transcriber)
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b:
        join(b)
        for _ in range(7):
            b.send_bytes(tone(1, amplitude=0))
        status, _ = receive_until(b, "analysis-status")
        while status["state"] != "silence":
            status, _ = receive_until(b, "analysis-status")
        b.send_json({"type": "ping"})
        receive_until(b, "pong")
    assert transcriber.calls == 0


def test_invalid_audio_frames_are_rejected():
    use(FakeTranscriber(transcript_of("hello")))
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b:
        join(b)
        b.send_bytes(b"\x00\x01\x02")
        assert b.receive_json()["code"] == "bad_frame"
        b.send_bytes(tone(5))
        assert b.receive_json()["code"] == "frame_too_large"


def test_server_busy_is_reported_not_queued(monkeypatch):
    use(FakeTranscriber(transcript_of(SCAM)))
    full = threading.BoundedSemaphore(1)
    full.acquire()
    monkeypatch.setattr(analysis_api, "_admission", lambda: full)
    monkeypatch.setattr("app.api.calls._admission", lambda: full)
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b:
        join(b)
        for _ in range(6):
            b.send_bytes(tone(1))
        status, _ = receive_until(b, "analysis-status")
        while status["state"] != "busy":
            status, _ = receive_until(b, "analysis-status")
    full.release()


def test_leaving_tells_the_other_participant_and_frees_the_place():
    use(FakeTranscriber(transcript_of("hello")))
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as a:
        join(a)
        with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b:
            join(b)
            a.receive_json()
            b.send_json({"type": "leave"})
        message = a.receive_json()
        assert message["type"] == "peer-left" and message["reason"] == "ended"
        assert len(get_registry().get(room).participants) == 1


def test_a_dropped_participant_can_resume_their_place():
    use(FakeTranscriber(transcript_of("hello")))
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as a:
        join(a)
        with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b:
            token = join(b)["token"]
            a.receive_json()
        assert a.receive_json()["type"] == "peer-reconnecting"
        with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b2:
            welcome = join(b2, resume=token, has_media=True)
            assert welcome["resumed"] is True
            assert a.receive_json()["type"] == "peer-resumed"
        assert a.receive_json()["type"] == "peer-reconnecting"
        with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b3:
            join(b3, resume=token)  # a rejoin without a media session, so the other side must offer again
            assert a.receive_json()["type"] == "peer-joined"
            with client.websocket_connect(f"/api/v1/calls/{room}/ws") as c:
                c.send_json({"type": "join", "consent": True, "resume": "not-the-token"})
                assert c.receive_json()["code"] == "room_full"  # both places are taken by connected people


def test_room_creation_is_capped_per_client(monkeypatch):
    monkeypatch.setattr(get_settings(), "call_max_rooms_per_client", 2)
    assert client.post("/api/v1/calls").status_code == 201
    assert client.post("/api/v1/calls").status_code == 201
    response = client.post("/api/v1/calls")
    assert response.status_code == 429 and response.json()["detail"]["code"] == "too_many_rooms"


def test_rooms_in_use_do_not_count_towards_the_per_client_cap(monkeypatch):
    use(FakeTranscriber(transcript_of("hello")))
    monkeypatch.setattr(get_settings(), "call_max_rooms_per_client", 1)
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as ws:
        join(ws)
        assert client.post("/api/v1/calls").status_code == 201  # the first room is in use


def test_welcome_says_whether_the_models_are_loaded():
    class Loading(FakeTranscriber):
        loaded = False

    use(Loading(transcript_of("hello")))
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as ws:
        assert join(ws)["analysis"]["models_ready"] is False


def test_a_failed_scam_check_is_reported_as_degraded_not_listening():
    from tests.helpers import FAIL

    use(FakeTranscriber(error=FAIL))
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b:
        join(b)
        for _ in range(6):
            b.send_bytes(tone(1))
        analysis, _ = receive_until(b, "analysis")
        assert analysis["intent"]["risk"] == "unavailable" and analysis["errors"]
        status, _ = receive_until(b, "analysis-status")
        while status["state"] in ("collecting", "analyzing"):
            status, _ = receive_until(b, "analysis-status")
        assert status["state"] == "degraded"
        b.send_json({"type": "ping"})
        _, rest = receive_until(b, "pong")
        assert not [m for m in rest if m["type"] == "alert"]  # a failed check never becomes an alert or a "safe" result


def test_a_slow_analysis_is_reported_as_delayed(monkeypatch):
    import time as _time

    class Slow(FakeTranscriber):
        def transcribe(self, audio, language=None):
            _time.sleep(0.3)
            return super().transcribe(audio, language)

    monkeypatch.setattr(get_settings(), "call_analysis_delay_seconds", 0.05)
    use(Slow(transcript_of("hello there")))
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b:
        join(b)
        for _ in range(6):
            b.send_bytes(tone(1))
        _, seen = receive_until(b, "analysis")
        assert [m["state"] for m in seen if m["type"] == "analysis-status"][-1] == "delayed"


def test_a_new_participant_does_not_inherit_the_previous_persons_audio():
    use(FakeTranscriber(transcript_of("hello")))
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as a:
        join(a)
        with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b:
            join(b)
            a.receive_json()
            for _ in range(3):
                a.send_bytes(tone(1))
            a.send_json({"type": "ping"})
            receive_until(a, "pong")  # A's frames are processed before B leaves (separate sockets are not ordered)
            b.send_json({"type": "leave"})
        receive_until(a, "peer-left")
        listener = next(iter(get_registry().get(room).participants.values())).analyzer
        samples, start, end = listener.audio.window()
        assert len(samples) == 0 and end == 3


def test_reopening_the_link_after_a_crash_takes_over_the_dropped_place():
    use(FakeTranscriber(transcript_of("hello")))
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as a:
        first = join(a)
        with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b:
            join(b)
            receive_until(a, "peer-joined")
        receive_until(a, "peer-reconnecting")  # B's browser vanished; its place is held for the grace period
        with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b2:
            welcome = join(b2)  # a fresh page has no resume token
            assert welcome["resumed"] is False and welcome["peer"]["id"] == first["participant_id"]
            left, _ = receive_until(a, "peer-left")
            assert left["reason"] == "connection_lost"
            receive_until(a, "peer-joined")
            assert len(get_registry().get(room).participants) == 2


def test_live_analysis_writes_no_temporary_files():
    use(FakeTranscriber(transcript_of(SCAM)))
    before = {p.name for p in Path(tempfile.gettempdir()).glob("voxshield-*")}
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as b:
        join(b)
        for _ in range(6):
            b.send_bytes(tone(1))
        receive_until(b, "analysis")
    assert {p.name for p in Path(tempfile.gettempdir()).glob("voxshield-*")} == before


# ---- Units ----

def _report(text: str, risk: str, indicators: list[IntentIndicator]):
    from app.schemas import AudioMetadata
    from app.schemas_analysis import AnalysisReport

    return AnalysisReport(
        status="complete",
        audio=AudioMetadata(filename="w", format="pcm", size_bytes=1, duration_seconds=12, sample_rate_hz=16000, channels=1),
        transcript=transcript_of(text),
        voice=voice_result("inconclusive"),
        intent=IntentAssessment(risk=risk, summary="s", indicators=indicators),
        recommendations=RecommendationPlan(state="actions", headline="h"),
    )


def _indicator(category: str, sentence: str, severity="medium") -> IntentIndicator:
    return IntentIndicator(
        rule_id=category, category=category, severity=severity, segment_index=0, char_start=0, char_end=5, start_seconds=1.0,
        excerpt=sentence[:20], sentence=sentence, explanation="why", suggested_action="do this",
    )


def test_alert_tracker_dedupes_cools_down_and_escalates():
    now = [0.0]
    tracker = AlertTracker(cooldown_seconds=45, clock=lambda: now[0])
    first = _report("x", "elevated", [_indicator("urgency", "Do it now.")])
    assert len(tracker.alerts_for(first, 0, 12)) == 1
    assert tracker.alerts_for(first, 5, 17) == []  # same sentence seen again in the overlapping window
    now[0] = 10
    other = _report("x", "elevated", [_indicator("urgency", "Hurry up please.")])
    assert tracker.alerts_for(other, 10, 22) == []  # same tactic within the cooldown
    now[0] = 12
    worse = _report("x", "high", [_indicator("credential_request", "Read me the code.", "high")])
    (alert,) = tracker.alerts_for(worse, 12, 24)
    assert alert["level"] == "high" and alert["tactics"] == ["credential_request"]
    assert alert["call_time_seconds"] == 13.0
    assert tracker.alerts_for(_report("x", "none_detected", []), 20, 32) == []


def test_voice_alert_is_separate_and_carries_the_live_audio_caution():
    tracker = AlertTracker(cooldown_seconds=45, clock=lambda: 0.0)
    report = _report("hello", "none_detected", [])
    report.voice = voice_result("model_favors_fake")
    report.voice.windows_analyzed = 2
    assert tracker.alerts_for(report, 0, 12) == []  # one window alone is not enough over call codecs
    (alert,) = tracker.alerts_for(report, 5, 17)
    assert alert["kind"] == "voice" and alert["risk"] == "none_detected"
    assert "not validated" in alert["voice"]["caution"]
    assert tracker.alerts_for(report, 10, 22) == []  # cooldown


def test_a_scam_finding_never_makes_the_voice_look_fake():
    tracker = AlertTracker(cooldown_seconds=45, clock=lambda: 0.0)
    report = _report("x", "high", [_indicator("credential_request", "Read me the code.", "high")])
    report.voice = voice_result("model_favors_real")
    (alert,) = tracker.alerts_for(report, 0, 12)
    assert alert["kind"] == "scam" and alert["voice"]["verdict"] == "model_favors_real"


def test_a_voice_reading_interrupted_by_another_verdict_starts_over():
    tracker = AlertTracker(cooldown_seconds=45, clock=lambda: 0.0)
    fake, real = _report("x", "none_detected", []), _report("x", "none_detected", [])
    fake.voice = voice_result("model_favors_fake")
    real.voice = voice_result("inconclusive")
    for report, start in ((fake, 0), (real, 5), (fake, 10)):
        assert tracker.alerts_for(report, start, start + 12) == []


def test_new_evidence_inside_the_cooldown_is_added_to_the_earlier_alert():
    now = [0.0]
    tracker = AlertTracker(cooldown_seconds=45, clock=lambda: now[0])
    (first,), _ = tracker.evaluate(_report("x", "elevated", [_indicator("payment_pressure", "Send the money.")]), 0, 12)
    now[0] = 10
    alerts, updates = tracker.evaluate(_report("x", "elevated", [_indicator("payment_pressure", "Transfer it to this account.")]), 10, 22)
    assert alerts == []
    assert updates == [{"alert_id": first["id"], "evidence": [pytest.approx(updates[0]["evidence"][0])]}]
    assert updates[0]["evidence"][0]["sentence"] == "Transfer it to this account."


def test_an_inconclusive_window_does_not_use_up_a_sentence():
    tracker = AlertTracker(cooldown_seconds=45, clock=lambda: 0.0)
    sentence = [_indicator("credential_request", "Read me the code.", "high")]
    assert tracker.alerts_for(_report("x", "inconclusive", sentence), 0, 12) == []
    assert len(tracker.alerts_for(_report("x", "high", sentence), 5, 17)) == 1


def test_transcript_committer_keeps_each_sentence_once():
    committer = TranscriptCommitter(window_seconds=12, step_seconds=5)
    first = committer.commit([{"start": 0, "end": 4, "text": "one"}, {"start": 8, "end": 12, "text": "cut"}], window_end=12)
    assert [s["text"] for s in first] == ["one"]  # the last segment touches the edge and will be heard again whole
    second = committer.commit([{"start": 5, "end": 7, "text": "x"}, {"start": 8, "end": 13, "text": "whole"}, {"start": 13, "end": 15, "text": "two"}], window_end=17)
    assert [s["text"] for s in second] == ["x", "whole", "two"]
    assert committer.commit([{"start": 13, "end": 15, "text": "two"}], window_end=22) == []


def test_a_held_segment_is_not_lost_when_the_next_window_starts_late():
    # Reproduces a real call: analysis took ~6 s, so the next window began after the held segment had started.
    committer = TranscriptCommitter(window_seconds=12, step_seconds=5)
    first = committer.commit([{"start": 0, "end": 5.3, "text": "You must transfer $2,000 to the"}, {"start": 5.3, "end": 11, "text": "account I will give you today,"}], window_end=11, window_start=0)
    assert [s["text"] for s in first] == ["You must transfer $2,000 to the"]
    second = committer.commit([{"start": 7, "end": 10.7, "text": "or you will face legal action."}, {"start": 12.2, "end": 17.9, "text": "This is urgent."}], window_end=19, window_start=7)
    assert [s["text"] for s in second] == ["account I will give you today,", "This is urgent."]  # nothing lost, nothing repeated


def test_a_held_sentence_merged_into_an_earlier_segment_is_not_lost():
    # Also from a real call: the next window transcribed the held sentence as part of a segment that began earlier.
    committer = TranscriptCommitter(window_seconds=12, step_seconds=5)
    committer.commit([{"start": 10.9, "end": 12.5, "text": "This is an urgent message."}, {"start": 12.5, "end": 15, "text": "You owe an unpaid"}], window_end=15, window_start=3)
    later = committer.commit([{"start": 11, "end": 16.1, "text": "This is an urgent message. You owe an unpaid tax bill."}, {"start": 16.1, "end": 21.7, "text": "Pay today."}], window_end=23, window_start=11)
    assert [s["text"] for s in later] == ["This is an urgent message. You owe an unpaid tax bill.", "Pay today."]


def test_incoming_audio_keeps_only_the_window_and_limits_the_rate():
    settings = get_settings().model_copy(update={"call_max_ahead_seconds": 3})
    now = [0.0]
    audio = IncomingAudio(settings, clock=lambda: now[0])
    audio.append(tone(2))
    with pytest.raises(FrameRejected) as error:
        audio.append(tone(2))
    assert error.value.code == "too_fast"
    now[0] = 600  # a long idle period refills only up to the cap, never minutes of credit
    audio.append(tone(2))
    with pytest.raises(FrameRejected):
        audio.append(tone(2))
    for _ in range(10):
        now[0] += 2
        audio.append(tone(2))
    samples, start, end = audio.window()
    assert len(samples) == 12 * 16000 and end == 24 and start == 12


def test_turn_credentials_are_short_lived_and_never_the_secret():
    settings = get_settings().model_copy(update={"turn_urls": ["turn:turn.example:3478"], "turn_secret": "s3cret", "turn_credential_ttl_seconds": 60})
    servers = ice_servers(settings, "abcd", now=1000)
    turn = servers[-1]
    assert turn["username"] == "1060:abcd" and turn["credential"] and "s3cret" not in str(servers)
    assert all("credential" not in s for s in ice_servers(settings.model_copy(update={"turn_secret": None}), "abcd"))


def test_rooms_expire_when_idle_and_creation_is_capped():
    now = [0.0]
    settings = get_settings().model_copy(update={"call_max_rooms": 2, "call_room_idle_seconds": 60})
    registry = CallRegistry(settings, clock=lambda: now[0])
    first = registry.create()
    registry.create()
    from app.services.live_calls import RoomsFull

    with pytest.raises(RoomsFull):
        registry.create()
    now[0] = 61
    assert registry.get(first.id) is None
    registry.create()


# ---- Alert direction: each participant is warned about the OTHER participant's speech ----

USER1_SAYS = "Please read me the one time password we just sent to your phone."
USER2_SAYS = "You must transfer five hundred dollars to this account today, or you will be arrested."
HARMLESS = "Hi, it is me. How was your weekend? Let us have lunch on Friday."
USER1_TONE, USER2_TONE, HARMLESS_TONE = 220, 440, 660


def _dominant_hz(audio) -> int:
    spectrum = np.abs(np.fft.rfft(audio))
    return int(round(np.argmax(spectrum) * 16000 / len(audio) / 10) * 10)


class SpeakerTranscriber(FakeTranscriber):
    """Stands in for speech-to-text: each participant's 'voice' is a tone, and each tone carries that person's sentence."""

    TEXT = {USER1_TONE: USER1_SAYS, USER2_TONE: USER2_SAYS, HARMLESS_TONE: HARMLESS}

    def transcribe(self, audio, language=None):
        return transcript_of(self.TEXT[_dominant_hz(audio)])


class SpeakerVoice:
    """Stands in for the voice model: User 1's voice leans 'fake', everyone else's 'real'."""

    def classify(self, audio):
        result = voice_result("model_favors_fake" if _dominant_hz(audio) == USER1_TONE else "model_favors_real")
        result.windows_analyzed = 2
        return result


def recommended(text: str) -> set[str]:
    """The actions the real detector suggests for this sentence."""
    return {i.suggested_action for i in RuleBasedScamIntentAnalyzer().analyze(transcript_of(text)).indicators}


def speech(hz: int, seconds: float = 1) -> bytes:
    t = np.arange(int(16000 * seconds)) / 16000
    return (np.sin(2 * np.pi * hz * t) * 0.2 * 32767).astype("<i2").tobytes()


def collect(ws) -> list[dict]:
    """Everything sent to this participant so far (ends with the reply to a ping, so nothing is left in flight)."""
    ws.send_json({"type": "ping"})
    _, seen = receive_until(ws, "pong", limit=200)
    return seen


def wait_for(ws, predicate, limit=200) -> list[dict]:
    seen = []
    for _ in range(limit):
        message = ws.receive_json()
        seen.append(message)
        if predicate(message, seen):
            return seen
    raise AssertionError(f"condition not met in {seen}")


def analyses_done(n):
    return lambda m, seen: sum(1 for x in seen if x["type"] == "analysis") >= n


@pytest.fixture
def own_admission(monkeypatch):
    """These tests send all their audio at once, so a 'busy' answer caused by threads still finishing from earlier tests
    would never be retried (in a call, the next second of audio retries it). Busy handling has its own test."""
    monkeypatch.setattr("app.api.calls._admit", lambda: (lambda: None))


def test_each_participant_is_alerted_only_about_the_other_participants_speech(own_admission):
    use(SpeakerTranscriber(), SpeakerVoice())
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as user1, client.websocket_connect(f"/api/v1/calls/{room}/ws") as user2:
        id1 = join(user1)["participant_id"]
        id2 = join(user2)["participant_id"]
        receive_until(user1, "peer-joined")
        # Each browser forwards what it RECEIVES: user 2's browser sends user 1's speech, and vice versa.
        # Twelve seconds each, so the voice model reads two windows.
        for _ in range(12):
            user2.send_bytes(speech(USER1_TONE))
            user1.send_bytes(speech(USER2_TONE))
        at2 = wait_for(user2, analyses_done(2)) + collect(user2)
        at1 = wait_for(user1, analyses_done(2)) + collect(user1)

    def alerts(seen, kind):
        return [m["alert"] for m in seen if m["type"] == "alert" and m["alert"]["kind"] == kind]

    # 1. User 1's request for a code is alerted to user 2, attributed to user 1.
    (scam_at2,) = alerts(at2, "scam")
    assert scam_at2["tactics"] == ["credential_request"] and scam_at2["source_participant_id"] == id1
    assert all(e["sentence"] == USER1_SAYS for e in scam_at2["evidence"])
    assert recommended(USER1_SAYS) <= set(scam_at2["actions"]) and not recommended(USER2_SAYS) & set(scam_at2["actions"])
    # 2. User 2's payment demand and threat are alerted to user 1, attributed to user 2.
    (scam_at1,) = alerts(at1, "scam")
    assert set(scam_at1["tactics"]) == {"payment_pressure", "coercion_threat"} and scam_at1["source_participant_id"] == id2
    assert all(e["sentence"] == USER2_SAYS for e in scam_at1["evidence"])
    assert recommended(USER2_SAYS) <= set(scam_at1["actions"]) and not recommended(USER1_SAYS) & set(scam_at1["actions"])
    # 3. Neither side sees its own sentence, tactics or duplicates.
    assert USER2_SAYS not in str(at2) and USER1_SAYS not in str(at1)
    assert len({a["id"] for a in alerts(at2, "scam")}) == len(alerts(at2, "scam")) == 1
    # The synthetic-voice warning follows the same direction: user 1's voice leans fake, so only user 2 is warned.
    (voice_at2,) = alerts(at2, "voice")
    assert voice_at2["source_participant_id"] == id1 and alerts(at1, "voice") == []
    assert scam_at1["voice"]["verdict"] == "model_favors_real"  # user 2's voice reading, shown to user 1
    # 4. Transcripts and results are attributed to the speaker, with times inside the analysed window.
    for seen, speaker, text in ((at2, id1, USER1_SAYS), (at1, id2, USER2_SAYS)):
        analyses = [m for m in seen if m["type"] == "analysis"]
        assert analyses and all(m["source_participant_id"] == speaker for m in analyses)
        assert {line["text"] for m in analyses for line in m["transcript"]} <= {text}
        for alert in alerts(seen, "scam"):
            window = alert["window"]
            assert all(window[0] <= e["call_time_seconds"] <= window[1] for e in alert["evidence"])


def test_attribution_survives_a_reconnect_and_follows_a_new_speaker(own_admission):
    use(SpeakerTranscriber(), SpeakerVoice())
    room = new_room()
    with client.websocket_connect(f"/api/v1/calls/{room}/ws") as user1:
        join(user1)
        with client.websocket_connect(f"/api/v1/calls/{room}/ws") as user2:
            token = join(user2)["token"]
        receive_until(user1, "peer-reconnecting")
        # User 2's signaling drops and resumes with the media still flowing: same speaker, same ID.
        with client.websocket_connect(f"/api/v1/calls/{room}/ws") as user2:
            resumed = join(user2, resume=token, has_media=True)
            id2 = resumed["participant_id"]
            receive_until(user1, "peer-resumed")
            for _ in range(6):
                user1.send_bytes(speech(USER2_TONE))
            seen = wait_for(user1, lambda m, s: m["type"] == "alert")
            assert seen[-1]["alert"]["source_participant_id"] == id2
            assert [m["source_participant_id"] for m in seen if m["type"] == "analysis"] == [id2]
            user2.send_json({"type": "leave"})
        receive_until(user1, "peer-left")
        # Someone else joins the same room: their speech is attributed to them, and none of user 2's audio carries over.
        with client.websocket_connect(f"/api/v1/calls/{room}/ws") as user3:
            id3 = join(user3)["participant_id"]
            receive_until(user1, "peer-joined")
            for _ in range(6):
                user1.send_bytes(speech(HARMLESS_TONE))
            seen = wait_for(user1, analyses_done(1))
            (analysis,) = [m for m in seen if m["type"] == "analysis"]
            assert analysis["source_participant_id"] == id3 and id3 != id2
            assert analysis["intent"]["risk"] == "none_detected"
            assert [line["text"] for line in analysis["transcript"]] in ([], [HARMLESS])
            assert not [m for m in seen + collect(user1) if m["type"] == "alert"]

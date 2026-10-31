"""Live browser-to-browser calls: rooms, the incoming-audio buffer for each listener, and alerts drawn from real analyses.

Each participant's browser sends the audio it *receives* from the other person (16 kHz mono 16-bit PCM). VoxShield
analyses that audio with the ordinary pipeline, on overlapping windows, and sends results and alerts only to that
listener. Nothing here writes audio to disk, and a listener's buffer is dropped as soon as they leave the call.

Everything runs on the server's event loop except the analysis itself, which runs in a worker thread. Rooms are kept
in memory, so calls need a single API worker process.
"""

import asyncio
import hashlib
import hmac
import base64
import logging
import re
import secrets
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np

from app.config import Settings
from app.schemas_analysis import AnalysisReport, IntentIndicator

logger = logging.getLogger("voxshield.calls")

SAMPLE_RATE = 16_000
BYTES_PER_SAMPLE = 2
ROOM_ID = re.compile(r"^[A-Za-z0-9_-]{10,32}$")
MAX_PARTICIPANTS = 2

INTENT_LEVEL = {"weak_signals": 1, "elevated": 2, "high": 3}
LEVEL_NAME = {1: "low", 2: "elevated", 3: "high"}

LIVE_LIMITATIONS = (
    "Based on short, overlapping windows of the other person's audio, not the whole call. A sentence cut at a window "
    "edge can be missed or misread."
)
VOICE_LIVE_CAUTION = (
    "The voice model was not validated on live WebRTC call audio. Calls are compressed with the Opus codec, and over "
    "VoIP codecs the model called up to 3 in 10 real voices 'fake' in VoxShield's benchmark. Treat this as a weak hint, "
    "never as proof, and judge the call by what is asked of you."
)
VOICE_TOO_SHORT = "Not enough speech in this window to assess the voice."
# Consecutive analyses that must lean "fake" before a voice alert is raised (each single reading is still shown).
VOICE_ALERT_WINDOWS = 2


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_room_id() -> str:
    return secrets.token_urlsafe(12)  # 16 characters, 96 random bits: not guessable, so a link is the invitation


def valid_room_id(value: str) -> bool:
    return bool(ROOM_ID.match(value))


def ice_servers(settings: Settings, participant_id: str, now: float | None = None) -> list[dict[str, Any]]:
    """STUN and TURN servers for one participant. TURN credentials are short-lived HMAC credentials (TURN REST API
    convention), so the long-term shared secret never leaves the server."""
    servers: list[dict[str, Any]] = []
    if settings.call_stun_urls:
        servers.append({"urls": list(settings.call_stun_urls)})
    if settings.turn_urls and settings.turn_secret:
        expires = int((now if now is not None else time.time()) + settings.turn_credential_ttl_seconds)
        username = f"{expires}:{participant_id}"
        digest = hmac.new(settings.turn_secret.encode(), username.encode(), hashlib.sha1).digest()
        servers.append({"urls": list(settings.turn_urls), "username": username, "credential": base64.b64encode(digest).decode()})
    return servers


class FrameRejected(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


class IncomingAudio:
    """The most recent stretch of one listener's incoming audio, plus a clock in seconds of audio received.

    Clients may not send audio faster than real time, and each frame has a size limit, so a misbehaving client cannot make
    the server buffer or analyse more than a live call would produce. The allowance is a token bucket: it refills at real
    time and holds at most `call_max_ahead_seconds`, so a burst after a network stall is accepted but a long idle period
    never turns into minutes of credit."""

    def __init__(self, settings: Settings, clock: Callable[[], float] = time.monotonic):
        self._settings = settings
        self._clock = clock
        self._refilled_at = clock()
        self._allowance = settings.call_max_ahead_seconds * SAMPLE_RATE
        self._keep = int(settings.call_analysis_window_seconds * SAMPLE_RATE)
        self._buffer = np.zeros(0, dtype=np.float32)
        self.total_samples = 0

    @property
    def seconds_received(self) -> float:
        return self.total_samples / SAMPLE_RATE

    def append(self, data: bytes) -> None:
        if not data or len(data) % BYTES_PER_SAMPLE:
            raise FrameRejected("bad_frame", "Audio frames must be 16-bit PCM.")
        if len(data) > self._settings.call_max_frame_seconds * SAMPLE_RATE * BYTES_PER_SAMPLE:
            raise FrameRejected("frame_too_large", "Audio frame is too large.")
        samples = len(data) // BYTES_PER_SAMPLE
        now = self._clock()
        cap = self._settings.call_max_ahead_seconds * SAMPLE_RATE
        self._allowance = min(cap, self._allowance + (now - self._refilled_at) * SAMPLE_RATE)
        self._refilled_at = now
        if samples > self._allowance:
            raise FrameRejected("too_fast", "Audio is arriving faster than a live call produces it.")
        self._allowance -= samples
        pcm = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
        self._buffer = np.concatenate([self._buffer, pcm])[-self._keep :]
        self.total_samples += samples

    def window(self) -> tuple[np.ndarray, float, float]:
        """A copy of the buffered audio with its start and end, in seconds of call audio."""
        end = self.seconds_received
        return self._buffer.copy(), end - len(self._buffer) / SAMPLE_RATE, end

    def clear(self) -> None:
        self._buffer = np.zeros(0, dtype=np.float32)


def rms(audio: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(audio)))) if len(audio) else 0.0


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9ऀ-෿]+", " ", text.lower()).strip()


@dataclass
class TranscriptCommitter:
    """Joins transcripts of overlapping windows into one running transcript without repeating text.

    A segment is kept only if it starts after the text already kept. The last segment of a window is held back when it
    touches the window's end (it is probably cut mid-sentence), so the next window can transcribe it whole. When analysis
    lags, the next window can start after that segment began; then the held text is kept as first transcribed rather
    than lost."""

    window_seconds: float
    step_seconds: float
    committed_until: float = 0.0
    held: dict[str, Any] | None = None

    def commit(self, segments: list[dict[str, Any]], window_end: float, final: bool = False, window_start: float | None = None) -> list[dict[str, Any]]:
        kept: list[dict[str, Any]] = []
        if self.held is not None:
            if window_start is not None and window_start > self.held["start"] + 0.25:
                kept.append(self.held)  # this window no longer covers its start
                self.committed_until = self.held["end"]
            self.held = None
        # A segment that starts inside text already kept but runs well past it holds new words too (the model can merge a
        # held sentence into the previous one). It is kept: a repeated phrase is better than words missing from the record.
        fresh = [
            s for s in segments
            if s["text"].strip() and (s["start"] >= self.committed_until - 0.25 or s["end"] > self.committed_until + 1.0)
        ]
        if fresh and not final:
            last = fresh[-1]
            next_window_start = window_end + self.step_seconds - self.window_seconds
            if last["end"] >= window_end - 0.8 and last["start"] >= next_window_start:
                fresh, self.held = fresh[:-1], last
        if fresh:
            self.committed_until = fresh[-1]["end"]
        return kept + fresh

    def release_held(self) -> list[dict[str, Any]]:
        """The held segment, kept as transcribed, when no later window will confirm it (the speaker went quiet)."""
        held, self.held = self.held, None
        if held is None:
            return []
        self.committed_until = max(self.committed_until, held["end"])
        return [held]


@dataclass
class AlertTracker:
    """Turns analysis reports into alerts, with cooldowns so overlapping windows do not repeat the same warning."""

    cooldown_seconds: float
    clock: Callable[[], float] = time.monotonic
    seen_sentences: set[str] = field(default_factory=set)
    category_alerted_at: dict[str, float] = field(default_factory=dict)
    category_alert_id: dict[str, str] = field(default_factory=dict)
    highest_level: int = 0
    voice_alerted_at: float | None = None
    voice_fake_streak: int = 0
    counter: int = 0

    def _id(self) -> str:
        self.counter += 1
        return f"AL-{self.counter}"

    def alerts_for(self, report: AnalysisReport, window_start: float, window_end: float) -> list[dict[str, Any]]:
        return self.evaluate(report, window_start, window_end)[0]

    def evaluate(self, report: AnalysisReport, window_start: float, window_end: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """New alerts, and updates that add evidence to an earlier alert.

        A sentence is used once. A new sentence of a tactic alerted within the cooldown does not raise a new alert, but
        its evidence is added to that earlier alert, so nothing the detector found is lost from the call or the report.
        A rise in risk level always raises a new alert."""
        now = self.clock()
        alerts: list[dict[str, Any]] = []
        updates: dict[str, list[dict[str, Any]]] = {}
        voice = voice_summary(report, window_end - window_start)
        intent = report.intent
        level = INTENT_LEVEL.get(intent.risk, 0)
        direct = [i for i in intent.indicators if i.context == "direct"]

        fresh: list[IntentIndicator] = []
        suppressed: list[IntentIndicator] = []
        for indicator in direct:
            key = f"{indicator.category}|{_normalize(indicator.sentence or indicator.excerpt)}"
            if key in self.seen_sentences or not level:
                continue  # an inconclusive window does not use up a sentence; a later window may confirm it
            self.seen_sentences.add(key)
            recent = self.category_alerted_at.get(indicator.category)
            if recent is None or now - recent >= self.cooldown_seconds or level > self.highest_level:
                fresh.append(indicator)
            else:
                suppressed.append(indicator)

        if level and (fresh or level > self.highest_level):
            shown = fresh or direct
            alert = self._scam_alert(report, shown, level, window_start, window_end, voice)
            for indicator in shown:
                self.category_alerted_at[indicator.category] = now
                self.category_alert_id[indicator.category] = alert["id"]
            self.highest_level = max(self.highest_level, level)
            alerts.append(alert)
        for indicator in suppressed:
            updates.setdefault(self.category_alert_id[indicator.category], []).append(_evidence(indicator, window_start))

        # Over call codecs the voice model gives false "fake" readings, so one window alone never raises a voice alert.
        self.voice_fake_streak = self.voice_fake_streak + 1 if voice["verdict"] == "model_favors_fake" else 0
        if self.voice_fake_streak >= VOICE_ALERT_WINDOWS and (self.voice_alerted_at is None or now - self.voice_alerted_at >= 2 * self.cooldown_seconds):
            self.voice_alerted_at = now
            alerts.append(
                {
                    "id": self._id(),
                    "kind": "voice",
                    "level": "caution",
                    "created_at": utc_now(),
                    "call_time_seconds": round(window_start, 1),
                    "window": [round(window_start, 1), round(window_end, 1)],
                    "risk": intent.risk,
                    "reason": f"The voice model leaned towards a synthetic voice in {self.voice_fake_streak} analyses in a row.",
                    "tactics": [],
                    "evidence": [],
                    "voice": voice,
                    "actions": [
                        "Ask a question only the real person could answer, or call them back on a number you already have.",
                        "Do not act on a request just because the voice sounds familiar.",
                    ],
                    "limitations": [VOICE_LIVE_CAUTION, LIVE_LIMITATIONS],
                }
            )
        return alerts, [{"alert_id": alert_id, "evidence": evidence} for alert_id, evidence in updates.items()]

    def _scam_alert(self, report: AnalysisReport, indicators: list[IntentIndicator], level: int, window_start: float, window_end: float, voice: dict[str, Any]) -> dict[str, Any]:
        intent = report.intent
        ordered = sorted(indicators, key=lambda i: {"high": 0, "medium": 1, "low": 2}[i.severity])
        evidence = [_evidence(i, window_start) for i in ordered]
        actions: list[str] = []
        for indicator in ordered:
            if indicator.suggested_action not in actions:
                actions.append(indicator.suggested_action)
        for item in report.recommendations.items:
            text = f"{item.title}. {item.detail}" if item.detail else item.title
            if len(actions) < 4 and text not in actions:
                actions.append(text)
        limitations = [LIVE_LIMITATIONS]
        if intent.score_note:
            limitations.append(intent.score_note)
        if report.language and report.language.translation_note:
            limitations.append(report.language.translation_note)
        limitations.extend(report.transcript.quality_notes[:2])
        return {
            "id": self._id(),
            "kind": "scam",
            "level": LEVEL_NAME[level],
            "created_at": utc_now(),
            "call_time_seconds": evidence[0]["call_time_seconds"] if evidence and evidence[0]["call_time_seconds"] is not None else round(window_start, 1),
            "window": [round(window_start, 1), round(window_end, 1)],
            "risk": intent.risk,
            "reason": ordered[0].explanation if ordered else intent.summary,
            "summary": intent.summary,
            "tactics": list(dict.fromkeys(i.category for i in ordered)),
            "evidence": evidence,
            "voice": voice,
            "actions": actions[:4],
            "limitations": limitations,
            "detector": intent.detector,
        }


def _evidence(i: IntentIndicator, window_start: float) -> dict[str, Any]:
    return {
        "category": i.category,
        "severity": i.severity,
        "excerpt": i.excerpt,
        "sentence": i.sentence or i.excerpt,
        "original_text": i.original_text,
        "call_time_seconds": round(window_start + i.start_seconds, 1) if i.start_seconds is not None else None,
        "explanation": i.explanation,
        "detector": i.detector,
        "score": i.score,
    }


def voice_summary(report: AnalysisReport, window_seconds: float) -> dict[str, Any]:
    voice = report.voice
    caution = VOICE_LIVE_CAUTION if voice.verdict in ("model_favors_fake", "model_favors_real") else None
    return {
        "verdict": voice.verdict,
        "fake_score_median": voice.fake_score_median,
        "windows_analyzed": voice.windows_analyzed,
        "summary": voice.summary if voice.windows_analyzed or voice.verdict == "unavailable" else VOICE_TOO_SHORT,
        "caution": caution,
        "window_seconds": round(window_seconds, 1),
        "error": voice.error,
    }


def run_state(report: AnalysisReport) -> tuple[str, str]:
    """The analysis status after a window. A check that could not run is never reported as plain "listening"."""
    if report.intent.risk == "unavailable" and report.voice.verdict == "unavailable":
        return "unavailable", "The analysis models could not run on the last window. Analysis continues with the next audio."
    if report.intent.risk == "unavailable":
        return "degraded", f"The scam check could not run on the last window ({report.intent.error or 'no transcript'}). The voice check still ran."
    if report.voice.verdict == "unavailable":
        return "degraded", "The voice check could not run on the last window. The scam check still ran."
    return "listening", "Listening."


def analysis_event(report: AnalysisReport, window_start: float, window_end: float, transcript: list[dict[str, Any]], skipped_seconds: float, seq: int = 0) -> dict[str, Any]:
    return {
        "type": "analysis",
        "seq": seq,
        "analyzed_at": utc_now(),
        "window": [round(window_start, 1), round(window_end, 1)],
        "status": report.status,
        "transcript": transcript,
        "language": report.language.code if report.language else None,
        "intent": {"risk": report.intent.risk, "summary": report.intent.summary, "error": report.intent.error, "detector": report.intent.detector},
        "voice": voice_summary(report, window_end - window_start),
        "errors": [{"component": e.component, "message": e.message} for e in report.errors],
        "skipped_seconds": round(skipped_seconds, 1),
        "seconds": report.timings_seconds.get("total"),
    }


Analyze = Callable[[np.ndarray], AnalysisReport]
Send = Callable[[dict[str, Any]], Awaitable[None]]
Admit = Callable[[], Callable[[], None] | None]


class LiveAnalyzer:
    """Schedules analyses of one listener's incoming audio: at most one at a time, only after enough new audio, and
    never on silence. Results go to `send`; a closed analyzer drops whatever is still running."""

    def __init__(self, settings: Settings, analyze: Analyze, send: Send, admit: Admit, clock: Callable[[], float] = time.monotonic):
        self._settings = settings
        self._analyze = analyze
        self._send = send
        self._admit = admit
        self.audio = IncomingAudio(settings, clock)
        self.alerts = AlertTracker(settings.call_alert_cooldown_seconds, clock)
        self.transcript = TranscriptCommitter(settings.call_analysis_window_seconds, settings.call_analysis_step_seconds)
        self._analyzed_until = 0.0
        # Whose speech this listener is receiving: the other participant. Stamped on every result, so attribution is
        # explicit and never inferred.
        self.source_id: str | None = None
        self._task: asyncio.Task | None = None
        self._status: str | None = None
        self.closed = False
        self.runs = 0

    @property
    def busy(self) -> bool:
        return self._task is not None and not self._task.done()

    async def feed(self, data: bytes) -> None:
        if self.closed:
            return
        self.audio.append(data)
        await self.maybe_start()

    async def _status_once(self, state: str, detail: str) -> None:
        if state != self._status:
            self._status = state
            await self._send({"type": "analysis-status", "state": state, "detail": detail})

    async def maybe_start(self) -> None:
        if self.closed or self.busy:
            return
        new_audio = self.audio.seconds_received - self._analyzed_until
        if new_audio < self._settings.call_analysis_step_seconds:
            if self._status is None:
                await self._status_once("collecting", "Collecting the first seconds of the other person's audio.")
            return
        audio, start, end = self.audio.window()
        if rms(audio[-int(new_audio * SAMPLE_RATE) :]) < self._settings.call_silence_rms:
            self._analyzed_until = end  # nothing new was said; do not spend a model run on it
            # The last sentence before a pause is held back until a later window confirms it, and silence never runs one.
            # Nothing follows it, so it is complete: release it instead of leaving it out of the transcript.
            released = self.transcript.release_held()
            if released:
                await self._send({"type": "transcript", "transcript": released, "source_participant_id": self.source_id})
            await self._status_once("silence", "No speech heard from the other person in the last few seconds.")
            return
        release = self._admit()
        if release is None:
            await self._status_once("busy", "VoxShield is busy with other analyses. Retrying with the next audio.")
            return
        skipped = max(0.0, start - self._analyzed_until)
        self._analyzed_until = end
        self._task = asyncio.create_task(self._run(audio, start, end, skipped, release, self.source_id))

    async def _run(self, audio: np.ndarray, start: float, end: float, skipped: float, release: Callable[[], None], source: str | None = None) -> None:
        try:
            await self._status_once("analyzing", "Analysing the other person's audio.")
            self._status = None  # always report the next state after a run
            job = asyncio.ensure_future(asyncio.to_thread(self._analyze, audio))
            try:
                done, _ = await asyncio.wait({job}, timeout=self._settings.call_analysis_delay_seconds)
                if not done and not self.closed:
                    # The call carries on; the listener is told the result is late instead of seeing a silent "safe".
                    await self._send({"type": "analysis-status", "state": "delayed", "detail": "Analysis is taking longer than usual. Results will appear when it finishes."})
                report = await job
            finally:
                if job.done():
                    release()
                else:
                    job.add_done_callback(lambda _: release())  # cancelled while waiting: free the slot when the thread ends
                del audio
            if self.closed:
                return
            self.runs += 1
            segments = [{"start": round(start + s.start_seconds, 1), "end": round(start + s.end_seconds, 1), "text": s.text.strip()} for s in report.transcript.segments]
            await self._send({**analysis_event(report, start, end, self.transcript.commit(segments, end, window_start=start), skipped, self.runs), "source_participant_id": source})
            alerts, updates = self.alerts.evaluate(report, start, end)
            for alert in alerts:
                await self._send({"type": "alert", "alert": {**alert, "source_participant_id": source}})
            for update in updates:
                await self._send({"type": "alert-update", **update, "source_participant_id": source})
            state, detail = run_state(report)
            await self._status_once(state, detail)
        except Exception as error:  # never let one failed window end the call
            logger.error("Live analysis failed: %s", type(error).__name__)
            if not self.closed:
                await self._send({"type": "analysis-status", "state": "error", "detail": "One analysis window failed. Analysis continues with the next audio."})
                self._status = "error"
        self._task = None  # this run is over, so the next window may start now rather than on the next audio frame
        if not self.closed:
            await self.maybe_start()

    def listen_to(self, source_id: str | None, fresh: bool) -> None:
        """The participant whose audio this listener now receives. A fresh media session drops the earlier audio."""
        if fresh:
            self.reset_audio()
        self.source_id = source_id

    def reset_audio(self) -> None:
        """The other participant changed: drop their audio so the next window holds only the new person's speech.
        Alerts already raised, and the sentences already used, are kept for the rest of the call."""
        self.audio.clear()
        self._analyzed_until = self.audio.seconds_received
        self.transcript.committed_until = self.audio.seconds_received
        self.transcript.held = None

    def close(self) -> None:
        self.closed = True
        self.audio.clear()


@dataclass
class Participant:
    id: str
    token: str
    analyzer: LiveAnalyzer | None = None
    socket: Any = None
    connected: bool = False
    grace_task: asyncio.Task | None = None
    # Serializes sends to this participant's socket. One lock per event loop: an asyncio.Lock must never be awaited from
    # another loop. The server runs every socket on one loop, so this is a single lock there; test clients use a loop
    # per socket, and a shared lock could hang them when the other participant's handler sends.
    _locks: dict[Any, asyncio.Lock] = field(default_factory=dict)

    async def send(self, message: dict[str, Any]) -> None:
        socket = self.socket
        if socket is None:
            return
        lock = self._locks.setdefault(asyncio.get_running_loop(), asyncio.Lock())
        async with lock:
            try:
                await socket.send_json(message)
            except Exception:
                pass  # the receive loop notices the closed socket and cleans up

    def close(self) -> None:
        if self.analyzer:
            self.analyzer.close()
            self.analyzer = None
        if self.grace_task and not self.grace_task.done():
            self.grace_task.cancel()
        self.socket = None
        self.connected = False


@dataclass
class CallRoom:
    id: str
    created_at: float
    participants: dict[str, Participant] = field(default_factory=dict)
    empty_since: float | None = None
    creator: str | None = None  # client address, only to cap rooms per client; never sent anywhere

    def peer_of(self, participant_id: str) -> Participant | None:
        return next((p for pid, p in self.participants.items() if pid != participant_id), None)


class RoomsFull(Exception):
    pass


class TooManyRoomsForClient(Exception):
    pass


class CallRegistry:
    def __init__(self, settings: Settings, clock: Callable[[], float] = time.monotonic):
        self._settings = settings
        self._clock = clock
        self.rooms: dict[str, CallRoom] = {}

    def purge(self) -> None:
        now = self._clock()
        idle = self._settings.call_room_idle_seconds
        for room_id in [r.id for r in self.rooms.values() if not r.participants and now - (r.empty_since or r.created_at) > idle]:
            self.rooms.pop(room_id, None)

    def create(self, client: str | None = None) -> CallRoom:
        self.purge()
        if len(self.rooms) >= self._settings.call_max_rooms:
            raise RoomsFull()
        if client and sum(1 for r in self.rooms.values() if r.creator == client and not r.participants) >= self._settings.call_max_rooms_per_client:
            raise TooManyRoomsForClient()
        room = CallRoom(id=new_room_id(), created_at=self._clock(), empty_since=self._clock(), creator=client)
        self.rooms[room.id] = room
        return room

    def get(self, room_id: str) -> CallRoom | None:
        self.purge()
        return self.rooms.get(room_id) if valid_room_id(room_id) else None

    def remove_participant(self, room: CallRoom, participant: Participant) -> None:
        participant.close()
        room.participants.pop(participant.id, None)
        if not room.participants:
            room.empty_since = self._clock()

    def close_all(self) -> None:
        for room in self.rooms.values():
            for participant in list(room.participants.values()):
                participant.close()
        self.rooms.clear()

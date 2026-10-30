"""Live Call Protection: room creation and one WebSocket per participant.

The socket carries WebRTC signaling between the two participants, the audio each browser *receives* from the other
person (binary frames of 16 kHz mono 16-bit PCM), and the analysis results and alerts for that listener only. Media
itself flows browser to browser over WebRTC and never passes through this server.
"""

import asyncio
import hmac
import json
import logging
import re
import secrets
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect

from app.api.analysis import _admission, _final_report
from app.config import get_settings
from app.dependencies import get_pipeline
from app.errors import UploadError
from app.middleware import SlidingWindowLimiter
from app.schemas import AudioMetadata, CallRoomCreated, ErrorBody
from app.services.languages import UnsupportedLanguage, parse_requested_language
from app.services.live_calls import (
    MAX_PARTICIPANTS, SAMPLE_RATE, CallRegistry, CallRoom, FrameRejected, LiveAnalyzer, Participant, RoomsFull, TooManyRoomsForClient, ice_servers,
)
from app.services.pipeline import AnalysisPipeline

logger = logging.getLogger("voxshield.calls")
router = APIRouter(prefix="/calls", tags=["calls"])

JOIN_TIMEOUT_SECONDS = 10
MAX_TEXT_BYTES = 64 * 1024
MAX_FRAME_REJECTIONS = 20
SIGNAL_KINDS = {"offer", "answer", "ice", "restart"}
ANALYSIS_NOTICE = (
    "VoxShield analyses the audio each participant receives in this call, to warn them about scam tactics. Audio is "
    "analysed in memory and not stored; transcripts and alerts are shown only to the listener they were made for."
)

# Application close codes. 4xxx is reserved for applications by RFC 6455.
CLOSE_NOT_FOUND, CLOSE_FULL, CLOSE_BAD, CLOSE_ORIGIN, CLOSE_RATE, CLOSE_REPLACED = 4404, 4409, 4400, 4403, 4429, 4001


@lru_cache
def get_registry() -> CallRegistry:
    return CallRegistry(get_settings())


@router.post("", response_model=CallRoomCreated, status_code=201, responses={503: {"model": ErrorBody}})
def create_room(request: Request, registry: CallRegistry = Depends(get_registry)) -> CallRoomCreated:
    """Create a private two-person call room. The room ID is the invitation: share it only with the person you call."""
    try:
        room = registry.create(client=request.client.host if request.client else None)
    except RoomsFull as error:
        raise UploadError(503, "calls_full", "Too many calls are open on this server. Please try again later.") from error
    except TooManyRoomsForClient as error:
        raise UploadError(429, "too_many_rooms", "You already have several call rooms open. Use one of them, or wait a few minutes.") from error
    return CallRoomCreated(room_id=room.id, max_participants=MAX_PARTICIPANTS, idle_expiry_seconds=get_settings().call_room_idle_seconds)


def _origin_allowed(origin: str | None) -> bool:
    """Browsers always send Origin on WebSocket requests and CORS does not apply to them, so it is checked here."""
    if origin is None:
        return True  # not a browser (tests, tools); such clients could set any header anyway
    settings = get_settings()
    if origin in settings.cors_origins:
        return True
    return bool(settings.cors_origin_regex and re.fullmatch(settings.cors_origin_regex, origin))


def _live_analyze(pipeline: AnalysisPipeline, language: str):
    def analyze(audio):
        metadata = AudioMetadata(
            filename="live-call-window", format="pcm", size_bytes=len(audio) * 2,
            duration_seconds=round(len(audio) / SAMPLE_RATE, 2), sample_rate_hz=SAMPLE_RATE, channels=1,
        )
        return _final_report(pipeline.run_samples(audio, metadata, language))

    return analyze


def _admit():
    slots = _admission()
    return slots.release if slots.acquire(blocking=False) else None


async def _close(websocket: WebSocket, code: int, error: str, message: str) -> None:
    try:
        await websocket.send_json({"type": "error", "code": error, "message": message})
        await websocket.close(code=code)
    except Exception:
        pass


async def _receive_join(websocket: WebSocket) -> dict[str, Any] | None:
    try:
        message = await asyncio.wait_for(websocket.receive(), JOIN_TIMEOUT_SECONDS)
    except (asyncio.TimeoutError, WebSocketDisconnect):
        return None
    text = message.get("text")
    if not text or len(text) > MAX_TEXT_BYTES:
        return None
    try:
        data = json.loads(text)
    except ValueError:
        return None
    return data if isinstance(data, dict) and data.get("type") == "join" else None


def _valid_signal(data: Any) -> bool:
    if not isinstance(data, dict) or data.get("kind") not in SIGNAL_KINDS:
        return False
    if data["kind"] in ("offer", "answer"):
        return isinstance(data.get("sdp"), str) and len(data["sdp"]) < MAX_TEXT_BYTES
    if data["kind"] == "ice":
        return data.get("candidate") is None or isinstance(data.get("candidate"), dict)
    return True


@router.websocket("/{room_id}/ws")
async def call_socket(websocket: WebSocket, room_id: str, registry: CallRegistry = Depends(get_registry), pipeline: AnalysisPipeline = Depends(get_pipeline)) -> None:
    settings = get_settings()
    if not _origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=CLOSE_ORIGIN)
        return
    await websocket.accept()
    room = registry.get(room_id)
    if room is None:
        await _close(websocket, CLOSE_NOT_FOUND, "room_not_found", "This call room does not exist or has expired. Ask for a new invitation.")
        return

    join = await _receive_join(websocket)
    if join is None or join.get("consent") is not True:
        await _close(websocket, CLOSE_BAD, "bad_join", "Joining needs the participant's consent to in-call analysis.")
        return
    try:
        language = parse_requested_language(join.get("language") if isinstance(join.get("language"), str) else None)
    except UnsupportedLanguage as error:
        await _close(websocket, CLOSE_BAD, "unsupported_language", str(error))
        return
    room = registry.get(room_id)  # it may have expired while waiting for the join message
    if room is None:
        await _close(websocket, CLOSE_NOT_FOUND, "room_not_found", "This call room does not exist or has expired. Ask for a new invitation.")
        return

    participant, resumed = _resume(room, join.get("resume"))
    if participant is None:
        if len(room.participants) >= MAX_PARTICIPANTS:
            # A participant whose connection already dropped (a crashed browser, a closed laptop) gives up their place
            # to a new join, so reopening the invitation link works without waiting for the grace period to end.
            stale = next((p for p in room.participants.values() if not p.connected), None)
            if stale is None:
                await _close(websocket, CLOSE_FULL, "room_full", "This call already has two participants.")
                return
            await _leave(registry, room, stale, "connection_lost")
        participant = Participant(id=secrets.token_hex(4), token=secrets.token_urlsafe(24))
        room.participants[participant.id] = participant
        room.empty_since = None
    elif participant.socket is not None and participant.socket is not websocket:
        old = participant.socket
        participant.socket = None
        await _close(old, CLOSE_REPLACED, "replaced", "This call was opened in another tab.")

    if participant.grace_task and not participant.grace_task.done():
        participant.grace_task.cancel()
    participant.socket, participant.connected = websocket, True
    wants_analysis = join.get("analyze", True) is not False
    if wants_analysis and participant.analyzer is None:
        participant.analyzer = LiveAnalyzer(settings, _live_analyze(pipeline, language), participant.send, _admit)
    elif not wants_analysis and participant.analyzer is not None:
        participant.analyzer.close()
        participant.analyzer = None

    peer = room.peer_of(participant.id)
    await participant.send({
        "type": "welcome",
        "participant_id": participant.id,
        "token": participant.token,
        "resumed": resumed,
        "peer": {"id": peer.id, "connected": peer.connected} if peer else None,
        "ice_servers": ice_servers(settings, participant.id),
        "analysis": {
            "enabled": participant.analyzer is not None,
            "models_ready": pipeline.models_loaded(),
            "sample_rate": SAMPLE_RATE,
            "window_seconds": settings.call_analysis_window_seconds,
            "step_seconds": settings.call_analysis_step_seconds,
            "max_frame_seconds": settings.call_max_frame_seconds,
        },
        "notice": ANALYSIS_NOTICE,
    })
    if peer:
        needs_offer = not resumed or join.get("has_media") is not True
        # Each analyzer listens to the OTHER participant. A new media session never mixes in the previous audio.
        if peer.analyzer:
            peer.analyzer.listen_to(participant.id, fresh=needs_offer)
        if participant.analyzer:
            participant.analyzer.listen_to(peer.id, fresh=False)
        await peer.send({"type": "peer-joined" if needs_offer else "peer-resumed", "peer_id": participant.id})

    await _serve(websocket, registry, room, participant)


def _resume(room: CallRoom, token: Any) -> tuple[Participant | None, bool]:
    if not isinstance(token, str) or not token:
        return None, False
    for participant in room.participants.values():
        if hmac.compare_digest(participant.token, token):
            return participant, True
    return None, False


async def _serve(websocket: WebSocket, registry: CallRegistry, room: CallRoom, participant: Participant) -> None:
    settings = get_settings()
    limiter = SlidingWindowLimiter(200, window=10.0)
    rejections = 0
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            if participant.socket is not websocket:
                return  # replaced by a newer connection for the same participant
            data = message.get("bytes")
            if data is not None:
                if participant.analyzer is None:
                    continue
                try:
                    await participant.analyzer.feed(data)
                except FrameRejected as error:
                    rejections += 1
                    if rejections > MAX_FRAME_REJECTIONS:
                        await _close(websocket, CLOSE_RATE, error.code, "Too many invalid audio frames.")
                        break
                    await participant.send({"type": "error", "code": error.code, "message": error.message})
                continue

            text = message.get("text") or ""
            if limiter.check("signal") is not None or len(text) > MAX_TEXT_BYTES:
                await _close(websocket, CLOSE_RATE, "too_many_messages", "Too many or too large messages.")
                break
            try:
                payload = json.loads(text)
            except ValueError:
                continue
            kind = payload.get("type") if isinstance(payload, dict) else None
            if kind == "signal" and _valid_signal(payload.get("data")):
                peer = room.peer_of(participant.id)
                if peer:
                    await peer.send({"type": "signal", "from": participant.id, "data": payload["data"]})
            elif kind == "ping":
                await participant.send({"type": "pong"})
            elif kind == "leave":
                await _leave(registry, room, participant, "ended")
                try:
                    await websocket.close(code=1000)
                except Exception:
                    pass
                return
    except WebSocketDisconnect:
        pass
    except Exception as error:
        logger.error("Call socket failed: %s", type(error).__name__)

    if participant.socket is not websocket:
        return
    participant.socket, participant.connected = None, False
    peer = room.peer_of(participant.id)
    if peer:
        await peer.send({"type": "peer-reconnecting", "peer_id": participant.id})
    participant.grace_task = asyncio.create_task(_expire(registry, room, participant, settings.call_reconnect_grace_seconds))


async def _expire(registry: CallRegistry, room: CallRoom, participant: Participant, grace: float) -> None:
    await asyncio.sleep(grace)
    participant.grace_task = None  # so leaving does not cancel this very task
    if not participant.connected:
        await _leave(registry, room, participant, "connection_lost")


async def _leave(registry: CallRegistry, room: CallRoom, participant: Participant, reason: str) -> None:
    if room.participants.get(participant.id) is not participant:
        return
    registry.remove_participant(room, participant)
    peer = room.peer_of(participant.id)
    if peer and peer.analyzer:
        peer.analyzer.listen_to(None, fresh=True)
    if peer:
        await peer.send({"type": "peer-left", "peer_id": participant.id, "reason": reason})

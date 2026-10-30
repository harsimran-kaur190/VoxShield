"""Request guards, written as plain ASGI middleware so streaming responses are never buffered or interrupted."""

import json
import logging
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]

logger = logging.getLogger("voxshield.guard")

BODY_OVERHEAD_BYTES = 1024 * 1024
LIMITED_PREFIXES = ("/api/v1/analysis", "/api/v1/uploads", "/api/v1/calls")


class SlidingWindowLimiter:
    """At most `limit` hits per `window` seconds for each key. Memory is bounded by `max_keys`."""

    def __init__(self, limit: int, window: float = 60.0, clock: Callable[[], float] = time.monotonic, max_keys: int = 10_000):
        self.limit, self.window, self._clock, self._max_keys = limit, window, clock, max_keys
        self._hits: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = threading.Lock()

    def check(self, key: str) -> float | None:
        """None when the request may go ahead, otherwise the seconds to wait before trying again."""
        if self.limit <= 0:
            return None
        now = self._clock()
        with self._lock:
            hits = self._hits.pop(key, deque())
            while hits and now - hits[0] >= self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                self._hits[key] = hits
                return max(0.0, self.window - (now - hits[0]))
            hits.append(now)
            self._hits[key] = hits  # most recently used goes last
            while len(self._hits) > self._max_keys:
                self._hits.popitem(last=False)
            return None


def _json(status: int, code: str, message: str, headers: list[tuple[bytes, bytes]] | None = None) -> tuple[Message, Message]:
    body = json.dumps({"detail": {"code": code, "message": message}}).encode()
    start = {
        "type": "http.response.start",
        "status": status,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), *(headers or [])],
    }
    return start, {"type": "http.response.body", "body": body}


class ApiGuard:
    """Rejects oversized bodies and floods early, and marks every API response as private and uncacheable.

    Responses can contain a transcript, so they must never be stored by a browser cache, CDN, or proxy.

    The request body is counted as it arrives, not only by its declared Content-Length. A chunked body has no declared
    length, and the framework would otherwise receive and spool all of it to disk before any size check in a route ran.
    Unexpected errors are answered here too, so they carry the same headers and are logged by class name only.
    """

    def __init__(self, app: Callable[[Scope, Receive, Send], Awaitable[None]], max_upload_bytes: int, requests_per_minute: int):
        self.app = app
        self.max_body = max_upload_bytes + BODY_OVERHEAD_BYTES
        self.max_upload_mb = max_upload_bytes // (1024 * 1024)
        self.limiter = SlidingWindowLimiter(requests_per_minute)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path, method = scope["path"], scope["method"]
        headers = {k.lower(): v for k, v in scope["headers"]}

        if method == "POST" and path.startswith(LIMITED_PREFIXES):
            client = (scope.get("client") or ("unknown", 0))[0]
            wait = self.limiter.check(client)
            if wait is not None:
                retry = str(max(1, int(wait + 0.999))).encode()
                start, body = _json(429, "rate_limited", "Too many requests. Please wait a moment and try again.", [(b"retry-after", retry), (b"cache-control", b"no-store")])
                await send(start)
                await send(body)
                return
            declared = headers.get(b"content-length", b"")
            if declared.isdigit() and int(declared) > self.max_body:
                start, body = _json(413, "file_too_large", f"File exceeds the {self.max_upload_mb} MB limit.", [(b"cache-control", b"no-store")])
                await send(start)
                await send(body)
                return

        body = {"received": 0, "rejected": False}
        state = {"started": False}

        async def respond(status: int, code: str, message: str) -> None:
            start, payload = _json(status, code, message, [(b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff"), (b"referrer-policy", b"no-referrer")])
            state["started"] = True
            await send(start)
            await send(payload)

        async def counted_receive() -> Message:
            if body["rejected"]:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request" and method == "POST" and path.startswith(LIMITED_PREFIXES):
                body["received"] += len(message.get("body", b""))
                if body["received"] > self.max_body:
                    # Stop reading: answer now and tell the application the client is gone, so nothing more is spooled.
                    body["rejected"] = True
                    if not state["started"]:
                        await respond(413, "file_too_large", f"File exceeds the {self.max_upload_mb} MB limit.")
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            if body["rejected"]:
                return  # the 413 has been sent; whatever the application now tries to send is discarded
            if message["type"] == "http.response.start":
                state["started"] = True
                if path.startswith("/api/"):
                    existing = {k.lower() for k, _ in message["headers"]}
                    extra = [(b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff"), (b"referrer-policy", b"no-referrer")]
                    message["headers"] = [*message["headers"], *[h for h in extra if h[0] not in existing]]
            await send(message)

        try:
            await self.app(scope, counted_receive, guarded_send)
        except Exception as error:
            if body["rejected"]:
                return  # the application only noticed the dropped connection
            logger.error("Unhandled error: %s", type(error).__name__)  # class name only: messages can contain user text
            if state["started"]:
                raise
            await respond(500, "server_error", "Something went wrong on the server.")

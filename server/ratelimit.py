"""Per-client sliding-window limiter (in memory — one process, one Mac mini)."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable

from fastapi import Request


def client_ip(request: Request) -> str:
    """Cloudflare puts the visitor's address in CF-Connecting-IP; the socket peer is the tunnel."""
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    return request.client.host if request.client else "unknown"


class SlidingWindowLimiter:
    def __init__(self, limit: int, window: float, clock: Callable[[], float]) -> None:
        self._limit = limit
        self._window = window
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}

    def hit(self, key: str) -> float | None:
        """Record a request. None if allowed, else seconds until the oldest hit expires."""
        now = self._clock()
        q = self._hits.setdefault(key, deque())
        while q and q[0] <= now - self._window:
            q.popleft()
        if len(q) >= self._limit:
            return q[0] + self._window - now
        q.append(now)
        if len(self._hits) > 10_000:
            self._prune(now)
        return None

    def _prune(self, now: float) -> None:
        for k in [k for k, q in self._hits.items() if not q or q[-1] <= now - self._window]:
            del self._hits[k]

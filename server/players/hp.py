"""Heroes Profile API v1 client for request-time lookups.

One attempt per call — no sleeping or retrying inside a web request; the service decides what to
serve instead. Every answer carries the quota reading from `X-HP-Quota-*` when HP sends one
(`X-HP-Quota-Reset` is seconds until the rolling window frees up; measured 2026-09-29).
Errors are `{"error": {"code", "message"}}` and are not charged. The token only ever goes into
the Authorization header; nothing here logs a header, a URL with credentials, or an exception text.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
import structlog

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class Quota:
    limit: int
    remaining: int
    reset_at: float  # epoch seconds


@dataclass(frozen=True)
class Upstream:
    status: int  # 0 = transport failure
    code: str | None  # HP error code, None on 2xx
    body: Any
    quota: Quota | None
    retry_after: float | None


def parse_quota(headers: httpx.Headers, now: float) -> Quota | None:
    try:
        return Quota(
            limit=int(headers["X-HP-Quota-Limit"]),
            remaining=int(headers["X-HP-Quota-Remaining"]),
            reset_at=now + float(headers["X-HP-Quota-Reset"]),
        )
    except (KeyError, ValueError):
        return None


def _retry_after(headers: httpx.Headers) -> float | None:
    try:
        return max(0.0, float(headers["Retry-After"]))
    except (KeyError, ValueError):
        return None


class HPClient:
    def __init__(
        self, *, base_url: str, token: str, http: httpx.AsyncClient, clock: Callable[[], float]
    ) -> None:
        self._base = base_url.rstrip("/")
        self._token = token
        self._http = http
        self._clock = clock

    def __repr__(self) -> str:
        return f"HPClient(base_url={self._base!r}, token=***)"

    async def aclose(self) -> None:
        await self._http.aclose()

    async def get(self, path: str, params: dict[str, str]) -> Upstream:
        headers = {"Authorization": f"Bearer {self._token}", "Accept": "application/json"}
        try:
            resp = await self._http.get(self._base + path, params=params, headers=headers)
        except httpx.HTTPError as e:
            log.warning("hp.transport_error", path=path, error=type(e).__name__)
            return Upstream(0, "transport_error", None, None, None)
        quota = parse_quota(resp.headers, self._clock())
        try:
            body: Any = resp.json()
        except ValueError:
            body = None
        if resp.is_success:
            return Upstream(resp.status_code, None, body, quota, None)
        err = body.get("error") if isinstance(body, dict) else None
        code = str(err.get("code", "http_error")) if isinstance(err, dict) else "http_error"
        log.info("hp.error", path=path, status=resp.status_code, code=code)
        return Upstream(resp.status_code, code, None, quota, _retry_after(resp.headers))

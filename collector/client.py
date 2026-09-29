"""Heroes Profile API v1 client: Bearer auth, 202 job polling, bounded retries.

Contract (docs, 2026-09-28):
- base `https://www.heroesprofile.com/api/external/v1`, `Authorization: Bearer <key>`
- global statistics answer 202 `{job_id}` + `Location` + `Retry-After` on a cache miss;
  poll `Location` while 202, the 200 body is the result (no envelope); `status: failed`
  means the query failed. Polling costs no quota; the per-key rate limit still applies.
- errors: `{"error": {"code", "message"}}` with real status codes; error answers are not
  charged. 429 carries `Retry-After` (seconds).
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import structlog

log = structlog.get_logger(__name__)

SleepFn = Callable[[float], Awaitable[None]]


class HPError(Exception):
    """An API failure with the server's status and error code. Never carries the token."""

    def __init__(self, status: int, code: str, message: str = "") -> None:
        self.status = status
        self.code = code
        self.message = message
        super().__init__(f"HP API {status} {code}: {message}")


def _envelope(resp: httpx.Response) -> tuple[str, str]:
    try:
        body = resp.json()
    except ValueError:
        return "http_error", resp.text[:200]
    err = body.get("error") if isinstance(body, dict) else None
    if isinstance(err, dict):
        return str(err.get("code", "http_error")), str(err.get("message", ""))
    if isinstance(body, dict) and "message" in body:
        return "http_error", str(body["message"])
    return "http_error", ""


def _retry_after(resp: httpx.Response, default: float) -> float:
    raw = resp.headers.get("Retry-After")
    if raw is None:
        return default
    try:
        return max(0.0, float(raw))
    except ValueError:
        return default


def _int_header(resp: httpx.Response, name: str) -> int | None:
    raw = resp.headers.get(name)
    try:
        return int(raw) if raw is not None else None
    except ValueError:
        return None


def _log_quota(resp: httpx.Response) -> None:
    """Every charged endpoint answers with X-HP-Quota-Remaining for its own weekly bucket."""
    remaining = _int_header(resp, "X-HP-Quota-Remaining")
    if remaining is None:
        return
    log.info(
        "hp.quota",
        path=resp.request.url.path,
        remaining=remaining,
        limit=_int_header(resp, "X-HP-Quota-Limit"),
    )


class HPClient:
    """Async client. Use as `async with HPClient(...) as c: await c.get_json(path, params)`."""

    def __init__(
        self,
        *,
        base_url: str,
        token: str,
        sleep: SleepFn,
        http: httpx.AsyncClient | None = None,
        poll_interval_default: float = 10.0,
        poll_max_seconds: float = 900.0,
        clock: Callable[[], float] = time.monotonic,
        timeout: float = 60.0,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._token = token
        self._sleep = sleep
        self._poll_default = poll_interval_default
        self._poll_max = poll_max_seconds
        self._clock = clock
        self._http = http or httpx.AsyncClient(timeout=timeout)
        self._owns_http = http is None

    def __repr__(self) -> str:
        return f"HPClient(base_url={self._base!r}, token=***)"

    async def __aenter__(self) -> HPClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        if self._owns_http:
            await self._http.aclose()

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}", "Accept": "application/json"}

    def _resolve(self, location: str) -> str:
        """Absolute `Location` as-is; a relative one is hung off the base URL's origin,
        without doubling the base path (`/v1/jobs/x` and `/jobs/x` both → base + `/jobs/x`)."""
        if location.startswith(("http://", "https://")):
            return location
        base = httpx.URL(self._base)
        origin = f"{base.scheme}://{base.netloc.decode()}"
        base_path = base.path.rstrip("/")
        loc = location if location.startswith("/") else "/" + location
        if base_path and loc.startswith(base_path + "/"):
            return origin + loc
        return origin + base_path + loc

    async def _request(self, url: str, params: dict[str, Any] | None) -> httpx.Response:
        """One GET with: one retry on transport error / 5xx, one wait-and-retry on 429."""
        attempt = 0
        while True:
            attempt += 1
            try:
                resp = await self._http.get(url, params=params, headers=self._headers())
            except httpx.TransportError as e:
                if attempt >= 2:
                    raise HPError(0, "transport_error", type(e).__name__) from None
                log.warning(
                    "hp.transport_retry", url_path=httpx.URL(url).path, error=type(e).__name__
                )
                await self._sleep(1.0)
                continue
            _log_quota(resp)
            if resp.status_code == 429:
                code, msg = _envelope(resp)
                # the weekly allowance does not come back in Retry-After seconds: never wait it out
                if attempt >= 2 or code == "quota_exceeded":
                    raise HPError(429, code, msg)
                wait = _retry_after(resp, self._poll_default)
                log.warning("hp.rate_limited", code=code, retry_after=wait)
                await self._sleep(wait)
                continue
            if resp.status_code >= 500:
                code, msg = _envelope(resp)
                if attempt >= 2:
                    raise HPError(resp.status_code, code, msg)
                log.warning("hp.server_error_retry", status=resp.status_code, code=code)
                await self._sleep(1.0)
                continue
            if resp.status_code >= 400:
                code, msg = _envelope(resp)
                raise HPError(resp.status_code, code, msg)
            return resp

    async def get_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = self._base + (path if path.startswith("/") else "/" + path)
        resp = await self._request(url, params)
        if resp.status_code != 202:
            return resp.json()
        location = resp.headers.get("Location")
        if not location:
            raise HPError(202, "job_without_location", "202 without Location header")
        job_url = self._resolve(location)
        wait = _retry_after(resp, self._poll_default)
        started = self._clock()
        polls = 0
        log.info("hp.job_started", path=path, retry_after=wait)
        while True:
            await self._sleep(wait)
            polls += 1
            resp = await self._request(job_url, None)
            if resp.status_code == 202:
                if self._clock() - started > self._poll_max:
                    raise HPError(202, "poll_timeout", f"job still pending after {polls} polls")
                wait = _retry_after(resp, self._poll_default)
                log.debug("hp.poll", polls=polls, retry_after=wait)
                continue
            body = resp.json()
            if isinstance(body, dict) and body.get("status") in {"failed", "not_found"}:
                raise HPError(200, "job_failed", str(body.get("reason") or body.get("status")))
            log.info("hp.job_done", path=path, polls=polls)
            return body

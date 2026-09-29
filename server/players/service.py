"""Player lookups: fresh cache → one live HP call (coalesced) → explicit degradation.

Quota guard, in order: HP's own reading (stop at `quota_floor` left in the rolling week, or after
a 429 quota_exceeded until its Retry-After), then our daily budget (live calls per UTC day), so a
single busy day cannot spend the whole week. When live calls are off, a cached profile is still
served — marked stale with the reason — and a player we have never seen gets `quota_exceeded`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import structlog

from server.config import Settings
from server.players.hp import HPClient, Quota, Upstream
from server.players.profile import normalize_player
from server.players.store import CacheEntry, HPStore

log = structlog.get_logger(__name__)

ENDPOINT = "players"  # HP bucket name: Player, 10,000/week on Basic
Outcome = Literal["ok", "not_found", "quota_exceeded", "unavailable"]
Notice = Literal["quota_exceeded", "upstream_unavailable"]


@dataclass(frozen=True)
class Lookup:
    outcome: Outcome
    profile: dict[str, Any] | None = None
    fetched_at: float | None = None
    source: Literal["cache", "live"] | None = None
    stale: bool = False
    notice: Notice | None = None
    retry_after: float | None = None


def _day(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d")


def _until_tomorrow(ts: float) -> float:
    now = datetime.fromtimestamp(ts, UTC)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return (tomorrow - now).total_seconds()


class PlayerService:
    def __init__(
        self, *, hp: HPClient, store: HPStore, settings: Settings, clock: Callable[[], float]
    ) -> None:
        self._hp = hp
        self._store = store
        self._settings = settings
        self._clock = clock
        self._inflight: dict[str, asyncio.Task[Lookup]] = {}

    async def lookup(self, battletag: str, region: str) -> Lookup:
        key = f"{ENDPOINT}|{region}|{battletag}"
        entry = await self._store.get(key)
        if entry is not None and entry.expires_at > self._clock():
            return self._from_entry(entry, battletag, region, source="cache")
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.create_task(self._refresh(key, battletag, region, entry))
            self._inflight[key] = task
            task.add_done_callback(lambda _t: self._inflight.pop(key, None))
        return await asyncio.shield(task)

    async def status(self) -> dict[str, Any]:
        now = self._clock()
        q = await self._store.quota(ENDPOINT)
        return {
            ENDPOINT: {
                "limit": q.limit if q else None,
                "remaining": q.remaining if q else None,
                "reset_at": _iso(q.reset_at) if q else None,
                "live_calls_today": await self._store.live_calls(_day(now), ENDPOINT),
                "daily_budget": self._settings.daily_live_budget,
            }
        }

    def _from_entry(
        self,
        e: CacheEntry,
        battletag: str,
        region: str,
        *,
        source: Literal["cache", "live"] | None,
        notice: Notice | None = None,
    ) -> Lookup:
        if e.status == 404:
            return Lookup("not_found", fetched_at=e.fetched_at, source=source)
        profile = normalize_player(e.body, battletag=battletag, region=region)
        return Lookup(
            "ok",
            profile=profile,
            fetched_at=e.fetched_at,
            source=source,
            stale=notice is not None,
            notice=notice,
        )

    def _degraded(
        self,
        stale: CacheEntry | None,
        battletag: str,
        region: str,
        notice: Notice,
        retry_after: float | None,
    ) -> Lookup:
        if stale is not None and stale.status == 200:
            return self._from_entry(stale, battletag, region, source="cache", notice=notice)
        if notice == "quota_exceeded":
            return Lookup("quota_exceeded", retry_after=retry_after)
        return Lookup("unavailable", retry_after=retry_after)

    async def _blocked_for(self, now: float) -> float | None:
        """Seconds until live calls may resume, or None when they are allowed now."""
        q = await self._store.quota(ENDPOINT)
        if q is not None and q.remaining <= self._settings.quota_floor and q.reset_at > now:
            return q.reset_at - now
        used = await self._store.live_calls(_day(now), ENDPOINT)
        if used >= self._settings.daily_live_budget:
            return _until_tomorrow(now)
        return None

    async def _refresh(
        self, key: str, battletag: str, region: str, stale: CacheEntry | None
    ) -> Lookup:
        now = self._clock()
        wait = await self._blocked_for(now)
        if wait is not None:
            log.info("players.live_blocked", retry_after=round(wait))
            return self._degraded(stale, battletag, region, "quota_exceeded", wait)

        up = await self._hp.get("/players", {"battletag": battletag, "region": region})
        now = self._clock()
        if up.quota is not None:
            await self._store.set_quota(ENDPOINT, up.quota, now)
        if up.status == 200 and isinstance(up.body, dict):
            await self._store.count_live_call(_day(now), ENDPOINT)
            entry = CacheEntry(key, 200, up.body, now, now + self._settings.player_ttl_seconds)
            await self._store.put(entry)
            log.info("players.live", region=region, remaining=_remaining(up))
            return self._from_entry(entry, battletag, region, source="live")
        if up.status == 404:
            entry = CacheEntry(key, 404, None, now, now + self._settings.not_found_ttl_seconds)
            await self._store.put(entry)
            return Lookup("not_found", fetched_at=now, source="live")
        if up.status == 429 and up.code == "quota_exceeded":
            reset = now + (up.retry_after if up.retry_after is not None else 3600.0)
            limit = up.quota.limit if up.quota else 0
            await self._store.set_quota(ENDPOINT, Quota(limit, 0, reset), now)
            log.warning("players.quota_exceeded", retry_after=round(reset - now))
            return self._degraded(stale, battletag, region, "quota_exceeded", reset - now)
        log.warning("players.upstream_unavailable", status=up.status, code=up.code)
        return self._degraded(stale, battletag, region, "upstream_unavailable", up.retry_after)


def _remaining(up: Upstream) -> int | None:
    return up.quota.remaining if up.quota else None


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

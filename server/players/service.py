"""Player lookups: fresh cache → one live HP call (coalesced) → explicit degradation.

Quota guard, in order: HP's own reading (stop at `quota_floor` left in the rolling week, or after
a 429 quota_exceeded until its Retry-After), then our daily budget (live calls per UTC day), so a
single busy day cannot spend the whole week. When live calls are off, a cached profile is still
served — marked stale with the reason, and never once HP returned it more than `stale_max_seconds`
ago — and a player we have never seen gets `quota_exceeded`.

Privacy (HP API terms §5): a player the privacy feed (`server/players/privacy.py`) or HP itself
(403 `player_unavailable`) reports private is answered `private` — from no cache, and without
asking HP again — and their cached answers are deleted.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

import structlog

from server.config import Settings
from server.players import quota
from server.players.hp import HPClient, Upstream
from server.players.profile import normalize_player
from server.players.store import CacheEntry, HPStore, player_key

log = structlog.get_logger(__name__)

ENDPOINT = "players"  # HP bucket name: Player, 10,000/week on Basic
Outcome = Literal["ok", "not_found", "private", "quota_exceeded", "unavailable"]
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
        if await self._store.is_private(region, battletag):
            return Lookup("private")
        key = player_key(region, battletag)
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
        budget = self._settings.daily_live_budget
        return {ENDPOINT: await quota.status(self._store, ENDPOINT, budget, self._clock())}

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
        too_old = stale is not None and (
            self._clock() - stale.fetched_at > self._settings.stale_max_seconds
        )
        if stale is not None and stale.status == 200 and not too_old:
            return self._from_entry(stale, battletag, region, source="cache", notice=notice)
        if notice == "quota_exceeded":
            return Lookup("quota_exceeded", retry_after=retry_after)
        return Lookup("unavailable", retry_after=retry_after)

    async def _refresh(
        self, key: str, battletag: str, region: str, stale: CacheEntry | None
    ) -> Lookup:
        now = self._clock()
        wait = await quota.blocked_for(
            self._store,
            ENDPOINT,
            floor=self._settings.quota_floor,
            budget=self._settings.daily_live_budget,
            now=now,
        )
        if wait is not None:
            log.info("players.live_blocked", retry_after=round(wait))
            return self._degraded(stale, battletag, region, "quota_exceeded", wait)

        up = await self._hp.get("/players", {"battletag": battletag, "region": region})
        now = self._clock()
        exhausted = await quota.record(self._store, ENDPOINT, up, now)
        if up.status == 200 and isinstance(up.body, dict):
            await self._store.count_live_call(quota.day(now), ENDPOINT)
            entry = CacheEntry(key, 200, up.body, now, now + self._settings.player_ttl_seconds)
            await self._store.put(entry)
            log.info("players.live", region=region, remaining=_remaining(up))
            return self._from_entry(entry, battletag, region, source="live")
        if up.status == 404:
            entry = CacheEntry(key, 404, None, now, now + self._settings.not_found_ttl_seconds)
            await self._store.put(entry)
            return Lookup("not_found", fetched_at=now, source="live")
        if up.status == 403 and up.code == "player_unavailable":
            await self._store.mark_private(region, battletag, quota.iso(now))
            log.info("players.private")
            return Lookup("private")
        if exhausted is not None:
            log.warning("players.quota_exceeded", retry_after=round(exhausted))
            return self._degraded(stale, battletag, region, "quota_exceeded", exhausted)
        log.warning("players.upstream_unavailable", status=up.status, code=up.code)
        return self._degraded(stale, battletag, region, "upstream_unavailable", up.retry_after)


def _remaining(up: Upstream) -> int | None:
    return up.quota.remaining if up.quota else None

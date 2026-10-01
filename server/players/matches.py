"""A player's match list: full stat lines while the small bucket allows, else the MMR history.

Order: fresh cache → one refresh per player at a time (coalesced):
1. `/players/matches` (bucket `player_match_history`, 250/week on Basic) when its quota guard
   allows — up to 100 games with the stat line, talents and per-game MMR. A cold query answers
   202; it is asked again every `hp_job_poll_seconds` for up to `hp_job_wait_seconds` (polls are
   not charged). Cached `match_ttl_seconds`.
2. Otherwise a cached full list HP returned less than `stale_max_seconds` ago, marked stale.
3. Otherwise `/players/mmr/history` (bucket `player_mmr_history`, 10,000/week) for the player's
   most played game type — the games with hero, map, result and MMR, no stat line. Cached
   `basic_match_ttl_seconds`, so a full list replaces it once the small bucket allows again.

Privacy is the same as for the profile (`service.py`): a private player gets `private`, and HP's
403 `player_unavailable` marks them private and drops every cached answer about them.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

import structlog

from server.config import Settings
from server.players import quota
from server.players.hp import HPClient, Upstream
from server.players.match_rows import basic_rows, full_rows
from server.players.service import Notice, Outcome, PlayerService
from server.players.store import CacheEntry, HPStore, matches_key

log = structlog.get_logger(__name__)

FULL = "player_match_history"  # HP bucket names
BASIC = "player_mmr_history"
Source = Literal["full", "basic"]


@dataclass(frozen=True)
class MatchLookup:
    outcome: Outcome
    source: Source | None = None
    matches: list[dict[str, Any]] = field(default_factory=list)
    fetched_at: float | None = None
    stale: bool = False
    notice: Notice | None = None
    retry_after: float | None = None


class MatchService:
    def __init__(
        self,
        *,
        hp: HPClient,
        store: HPStore,
        players: PlayerService,
        settings: Settings,
        clock: Callable[[], float],
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._hp = hp
        self._store = store
        self._players = players
        self._settings = settings
        self._clock = clock
        self._sleep = sleep
        self._inflight: dict[str, asyncio.Task[MatchLookup]] = {}

    async def lookup(self, battletag: str, region: str) -> MatchLookup:
        if await self._store.is_private(region, battletag):
            return MatchLookup("private")
        key = matches_key(region, battletag)
        entry = await self._store.get(key)
        if entry is not None and entry.expires_at > self._clock():
            return _from_entry(entry)
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.create_task(self._refresh(key, battletag, region, entry))
            self._inflight[key] = task
            task.add_done_callback(lambda _t: self._inflight.pop(key, None))
        return await asyncio.shield(task)

    async def status(self) -> dict[str, Any]:
        now, s = self._clock(), self._settings
        return {
            FULL: await quota.status(self._store, FULL, s.match_daily_budget, now),
            BASIC: await quota.status(self._store, BASIC, s.mmr_history_daily_budget, now),
        }

    async def _refresh(
        self, key: str, battletag: str, region: str, cached: CacheEntry | None
    ) -> MatchLookup:
        s = self._settings
        now = self._clock()
        notice: Notice = "quota_exceeded"
        wait = await quota.blocked_for(
            self._store, FULL, floor=s.match_quota_floor, budget=s.match_daily_budget, now=now
        )
        if wait is None:
            up = await self._ready("/players/matches", {"battletag": battletag, "region": region})
            now = self._clock()
            exhausted = await quota.record(self._store, FULL, up, now)
            if up.status == 200 and isinstance(up.body, dict):
                await self._store.count_live_call(quota.day(now), FULL)
                rows = full_rows(up.body)
                return await self._keep(key, "full", rows, now, s.match_ttl_seconds)
            if up.status == 404:
                return MatchLookup("not_found")
            if up.status == 403 and up.code == "player_unavailable":
                return await self._private(region, battletag, now)
            if exhausted is None:
                notice = "upstream_unavailable"
                log.warning("matches.full_unavailable", status=up.status, code=up.code)

        stale_full = (
            cached is not None
            and cached.status == 200
            and _d(cached.body).get("source") == "full"
            and self._clock() - cached.fetched_at <= s.stale_max_seconds
        )
        if stale_full and cached is not None:
            return _from_entry(cached, notice=notice)
        return await self._basic(key, battletag, region, cached)

    async def _basic(
        self, key: str, battletag: str, region: str, cached: CacheEntry | None
    ) -> MatchLookup:
        s = self._settings
        profile = await self._players.lookup(battletag, region)
        if profile.outcome != "ok" or profile.profile is None:
            return MatchLookup(profile.outcome, retry_after=profile.retry_after)
        mode = _main_mode(profile.profile)
        if mode is None:
            return await self._keep(key, "basic", [], self._clock(), s.basic_match_ttl_seconds)
        now = self._clock()
        wait = await quota.blocked_for(
            self._store,
            BASIC,
            floor=s.mmr_history_quota_floor,
            budget=s.mmr_history_daily_budget,
            now=now,
        )
        if wait is not None:
            return self._degraded(cached, "quota_exceeded", wait)
        params = {"battletag": battletag, "region": region, "game_type": mode}
        up = await self._hp.get("/players/mmr/history", params)
        now = self._clock()
        exhausted = await quota.record(self._store, BASIC, up, now)
        if up.status == 200 and isinstance(up.body, dict):
            await self._store.count_live_call(quota.day(now), BASIC)
            rows = basic_rows(up.body, mode)
            return await self._keep(key, "basic", rows, now, s.basic_match_ttl_seconds)
        if up.status == 403 and up.code == "player_unavailable":
            return await self._private(region, battletag, now)
        if exhausted is not None:
            return self._degraded(cached, "quota_exceeded", exhausted)
        log.warning("matches.basic_unavailable", status=up.status, code=up.code)
        return self._degraded(cached, "upstream_unavailable", up.retry_after)

    async def _ready(self, path: str, params: dict[str, str]) -> Upstream:
        """GET, asking again while HP answers 202 (job pending), up to the wait limit."""
        waited = 0.0
        while True:
            up = await self._hp.get(path, params)
            if up.status != 202:
                return up
            if waited + self._settings.hp_job_poll_seconds > self._settings.hp_job_wait_seconds:
                log.info("matches.job_pending", waited=waited)
                return Upstream(0, "job_pending", None, up.quota, None)
            await self._sleep(self._settings.hp_job_poll_seconds)
            waited += self._settings.hp_job_poll_seconds

    async def _keep(
        self, key: str, source: Source, rows: list[dict[str, Any]], now: float, ttl: int
    ) -> MatchLookup:
        entry = CacheEntry(key, 200, {"source": source, "matches": rows}, now, now + ttl)
        await self._store.put(entry)
        log.info("matches.live", source=source, games=len(rows))
        return _from_entry(entry)

    async def _private(self, region: str, battletag: str, now: float) -> MatchLookup:
        await self._store.mark_private(region, battletag, quota.iso(now))
        log.info("matches.private")
        return MatchLookup("private")

    def _degraded(
        self, cached: CacheEntry | None, notice: Notice, retry_after: float | None
    ) -> MatchLookup:
        if (
            cached is not None
            and cached.status == 200
            and self._clock() - cached.fetched_at <= self._settings.stale_max_seconds
        ):
            return _from_entry(cached, notice=notice)
        if notice == "quota_exceeded":
            return MatchLookup("quota_exceeded", retry_after=retry_after)
        return MatchLookup("unavailable", retry_after=retry_after)


def _d(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _from_entry(e: CacheEntry, *, notice: Notice | None = None) -> MatchLookup:
    body = _d(e.body)
    source: Source = "full" if body.get("source") == "full" else "basic"
    rows = body.get("matches")
    return MatchLookup(
        "ok",
        source=source,
        matches=rows if isinstance(rows, list) else [],
        fetched_at=e.fetched_at,
        stale=notice is not None,
        notice=notice,
    )


def _main_mode(profile: dict[str, Any]) -> str | None:
    """The game type the player has played most (HP's MMR history takes one at a time)."""
    modes = [m for m in profile.get("modes", []) if isinstance(m, dict) and m.get("mode")]
    if not modes:
        return None
    best = max(modes, key=lambda m: int(m.get("wins", 0)) + int(m.get("losses", 0)))
    return str(best["mode"])

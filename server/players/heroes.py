"""A player's stats per hero (전적 검색, #88): HP `/players/heroes`, one row per hero played.

Bucket `player_hero_all` (25/week on Basic, 500 on Intermediate). Every game type by default;
`game_type` narrows it to Quick Match or Storm League, each its own cache entry. Order: fresh cache
→ one refresh per player and mode at a time (coalesced) → under the quota guard, HP (a cold query
answers 202 and is asked again; polls are not charged) → past it, an answer HP gave less than
`stale_max_seconds` ago, marked stale → else `quota_exceeded`.

Privacy as for the profile: a private player gets `private` without a call, and HP's 403
`player_unavailable` marks them private (which drops every cached answer about them).
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
from server.players.service import Notice, Outcome
from server.players.store import CacheEntry, HPStore, heroes_key

log = structlog.get_logger(__name__)

BUCKET = "player_hero_all"  # HP bucket name
HeroMode = Literal["all", "qm", "sl"]


@dataclass(frozen=True)
class HeroStatsLookup:
    outcome: Outcome
    heroes: list[dict[str, Any]] = field(default_factory=list)
    fetched_at: float | None = None
    stale: bool = False
    notice: Notice | None = None
    retry_after: float | None = None


def _num(row: dict[str, Any], key: str) -> float:
    v = row.get(key)
    return float(v) if isinstance(v, int | float) else 0.0


def hero_rows(body: Any) -> list[dict[str, Any]]:
    """HP rows → what the page shows, most played first."""
    rows: list[dict[str, Any]] = []
    for r in body if isinstance(body, list) else []:
        if not isinstance(r, dict) or not isinstance(r.get("name"), str):
            continue
        h = r.get("hero")
        hero: dict[str, Any] = h if isinstance(h, dict) else {}
        rows.append(
            {
                "hero": r["name"],
                "short_name": hero.get("short_name"),
                "games": int(_num(r, "games_played")),
                "wins": int(_num(r, "wins")),
                "losses": int(_num(r, "losses")),
                "win_rate": _num(r, "win_rate"),
                "kda": _num(r, "kda"),
                "kills": _num(r, "avg_kills"),
                "deaths": _num(r, "avg_deaths"),
                "assists": _num(r, "avg_assists"),
                "hero_damage": _num(r, "avg_hero_damage"),
                "siege_damage": _num(r, "avg_siege_damage"),
                "healing": _num(r, "avg_healing"),
                "damage_taken": _num(r, "avg_damage_taken"),
                "experience": _num(r, "avg_experience_contribution"),
            }
        )
    return sorted(rows, key=lambda x: (-x["games"], x["hero"]))


class HeroStatsService:
    def __init__(
        self,
        *,
        hp: HPClient,
        store: HPStore,
        settings: Settings,
        clock: Callable[[], float],
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._hp = hp
        self._store = store
        self._settings = settings
        self._clock = clock
        self._sleep = sleep
        self._inflight: dict[str, asyncio.Task[HeroStatsLookup]] = {}

    async def lookup(self, battletag: str, region: str, mode: HeroMode) -> HeroStatsLookup:
        if await self._store.is_private(region, battletag):
            return HeroStatsLookup("private")
        key = heroes_key(region, battletag, mode)
        entry = await self._store.get(key)
        if entry is not None and entry.status == 200 and entry.expires_at > self._clock():
            return _from_entry(entry)
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.create_task(self._refresh(key, battletag, region, mode, entry))
            self._inflight[key] = task
            task.add_done_callback(lambda _t: self._inflight.pop(key, None))
        return await asyncio.shield(task)

    async def status(self) -> dict[str, Any]:
        s = self._settings
        return {
            BUCKET: await quota.status(
                self._store, BUCKET, s.hero_stats_daily_budget, self._clock()
            )
        }

    async def _refresh(
        self, key: str, battletag: str, region: str, mode: HeroMode, cached: CacheEntry | None
    ) -> HeroStatsLookup:
        s = self._settings
        wait = await quota.blocked_for(
            self._store,
            BUCKET,
            floor=s.hero_stats_quota_floor,
            budget=s.hero_stats_daily_budget,
            now=self._clock(),
        )
        if wait is not None:
            return self._degraded(cached, "quota_exceeded", wait)
        params = {"battletag": battletag, "region": region}
        if mode != "all":
            params["game_type"] = mode
        up = await self._ready(params)
        now = self._clock()
        exhausted = await quota.record(self._store, BUCKET, up, now)
        if up.status == 200:
            await self._store.count_live_call(quota.day(now), BUCKET)
            body = {"heroes": hero_rows(up.body)}
            entry = CacheEntry(key, 200, body, now, now + s.hero_stats_ttl_seconds)
            await self._store.put(entry)
            log.info("heroes.live", mode=mode, heroes=len(body["heroes"]))
            return _from_entry(entry)
        if up.status == 404:
            return HeroStatsLookup("not_found")
        if up.status == 403 and up.code == "player_unavailable":
            await self._store.mark_private(region, battletag, quota.iso(now))
            log.info("heroes.private")
            return HeroStatsLookup("private")
        if exhausted is not None:
            return self._degraded(cached, "quota_exceeded", exhausted)
        log.warning("heroes.unavailable", status=up.status, code=up.code)
        return self._degraded(cached, "upstream_unavailable", up.retry_after)

    async def _ready(self, params: dict[str, str]) -> Upstream:
        """GET, asking again while HP answers 202 (job pending), up to the wait limit."""
        waited = 0.0
        while True:
            up = await self._hp.get("/players/heroes", params)
            if up.status != 202:
                return up
            if waited + self._settings.hp_job_poll_seconds > self._settings.hp_job_wait_seconds:
                log.info("heroes.job_pending", waited=waited)
                return Upstream(0, "job_pending", None, up.quota, None)
            await self._sleep(self._settings.hp_job_poll_seconds)
            waited += self._settings.hp_job_poll_seconds

    def _degraded(
        self, cached: CacheEntry | None, notice: Notice, retry_after: float | None
    ) -> HeroStatsLookup:
        if (
            cached is not None
            and cached.status == 200
            and self._clock() - cached.fetched_at <= self._settings.stale_max_seconds
        ):
            return _from_entry(cached, stale=True, notice=notice)
        outcome: Outcome = "quota_exceeded" if notice == "quota_exceeded" else "unavailable"
        return HeroStatsLookup(outcome, retry_after=retry_after)


def _from_entry(
    e: CacheEntry, *, stale: bool = False, notice: Notice | None = None
) -> HeroStatsLookup:
    body = e.body if isinstance(e.body, dict) else {}
    return HeroStatsLookup(
        "ok", list(body.get("heroes") or []), e.fetched_at, stale=stale, notice=notice
    )

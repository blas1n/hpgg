"""A player's Storm League heroes this season (이번 시즌 card, owner 2026-10-14).

HP `/players/heroes?season=<current>&game_type=sl`, bucket `player_hero_all` (500/week on
Intermediate): one row per hero with games, wins, losses and the season's sums of kills, deaths,
assists and takedowns. It counts every game HP has, where the match list stops at the newest 100.
The current season is the newest one `/patches` lists, asked once a day.

Order: fresh cache (as long as the match list, `match_ttl_seconds`) → one refresh per player at a
time (coalesced) → under the quota guard, HP. A cold query answers 202 with a job id: `/jobs/{id}`
is polled, which HP does not charge (no X-HP-Quota reading on it, 2026-10-14), so only the first
ask counts → past the guard, an answer HP gave less than `stale_max_seconds` ago, marked stale →
else `quota_exceeded`. No Storm League this season (HP's empty list or 404) is an empty list.

Privacy as for the profile: a private player gets `private` without a call, and HP's 403
`player_unavailable` marks them private (which drops every cached answer about them).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import structlog

from server.config import Settings
from server.players import quota
from server.players.hp import HPClient, Upstream
from server.players.service import Notice, Outcome
from server.players.store import CacheEntry, HPStore, season_key

log = structlog.get_logger(__name__)

BUCKET = "player_hero_all"  # HP bucket name
# Bump when a row gains, loses or changes a field: answers cached in another format are asked again
# (still served stale while HP cannot be). 2 = the match card's stat line as sums (2026-10-14).
ROWS_VERSION = 2
# our field → HP's season sum: the stats a game card shows (owner 2026-10-14)
SUMS = {
    "kills": "sum_kills",
    "deaths": "sum_deaths",
    "assists": "sum_assists",
    "takedowns": "sum_takedowns",
    "hero_damage": "sum_hero_damage",
    "siege_damage": "sum_siege_damage",
    "healing": "sum_healing",
    "damage_taken": "sum_damage_taken",
    "experience": "sum_experience_contribution",
}
SEASONS_KEY = "hp_seasons"
MODE = "sl"


@dataclass(frozen=True)
class SeasonLookup:
    outcome: Outcome
    season: int | None = None
    heroes: list[dict[str, Any]] = field(default_factory=list)
    fetched_at: float | None = None
    stale: bool = False
    notice: Notice | None = None
    retry_after: float | None = None


def _int(row: dict[str, Any], key: str) -> int:
    v = row.get(key)
    return int(v) if isinstance(v, int | float) and not isinstance(v, bool) else 0


def season_rows(body: Any) -> list[dict[str, Any]]:
    """HP rows → one per hero, most played first; season sums, not per-game averages."""
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
                "role": hero.get("new_role"),
                "games": _int(r, "games_played"),
                "wins": _int(r, "wins"),
                "losses": _int(r, "losses"),
                **{ours: _int(r, theirs) for ours, theirs in SUMS.items()},
            }
        )
    return sorted(rows, key=lambda x: (-x["games"], -x["wins"], x["hero"]))


def current_season(body: Any) -> int | None:
    patches = body.get("patches") if isinstance(body, dict) else None
    rows = patches if isinstance(patches, list) else []
    seasons = [
        p["season"] for p in rows if isinstance(p, dict) and isinstance(p.get("season"), int)
    ]
    return max(seasons, default=None)


class SeasonService:
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
        self._inflight: dict[str, asyncio.Task[SeasonLookup]] = {}

    async def lookup(self, battletag: str, region: str) -> SeasonLookup:
        if await self._store.is_private(region, battletag):
            return SeasonLookup("private")
        season = await self._season()
        if season is None:
            return SeasonLookup("unavailable")
        key = season_key(region, battletag)
        entry = await self._store.get(key)
        if entry is not None and _season_of(entry) != season:
            entry = None  # last season's answer
        current = entry is not None and _d(entry.body).get("v") == ROWS_VERSION
        if entry is not None and current and entry.expires_at > self._clock():
            return _from_entry(entry)
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.create_task(self._refresh(key, battletag, region, season, entry))
            self._inflight[key] = task
            task.add_done_callback(lambda _t: self._inflight.pop(key, None))
        return await asyncio.shield(task)

    async def status(self) -> dict[str, Any]:
        s = self._settings
        budget = s.season_daily_budget
        return {BUCKET: await quota.status(self._store, BUCKET, budget, self._clock())}

    async def _season(self) -> int | None:
        cached = await self._store.get(SEASONS_KEY)
        known = _season_of(cached) if cached is not None else None
        if cached is not None and cached.expires_at > self._clock() and known is not None:
            return known
        up = await self._hp.get("/patches", {})
        season = current_season(up.body) if up.status == 200 else None
        if season is None:
            log.warning("season.patches_unavailable", status=up.status, code=up.code)
            return known
        now = self._clock()
        ttl = self._settings.season_list_ttl_seconds
        await self._store.put(CacheEntry(SEASONS_KEY, 200, {"season": season}, now, now + ttl))
        return season

    async def _refresh(
        self, key: str, battletag: str, region: str, season: int, cached: CacheEntry | None
    ) -> SeasonLookup:
        s = self._settings
        wait = await quota.blocked_for(
            self._store,
            BUCKET,
            floor=s.season_quota_floor,
            budget=s.season_daily_budget,
            now=self._clock(),
        )
        if wait is not None:
            return self._degraded(cached, "quota_exceeded", wait)
        params = {"battletag": battletag, "region": region, "season": str(season)}
        params["game_type"] = MODE
        up = await self._hp.get("/players/heroes", params)
        now = self._clock()
        await quota.charge(self._store, BUCKET, up, now)
        exhausted = await quota.record(self._store, BUCKET, up, now)
        if up.status == 202:
            up = await self._job(up)
            now = self._clock()
        if up.status == 200 or up.code == "not_found":
            rows = season_rows(up.body)
            body = {"v": ROWS_VERSION, "season": season, "heroes": rows}
            entry = CacheEntry(key, 200, body, now, now + s.match_ttl_seconds)
            await self._store.put(entry)
            log.info("season.live", season=season, heroes=len(rows))
            return _from_entry(entry)
        if up.status == 403 and up.code == "player_unavailable":
            await self._store.mark_private(region, battletag, quota.iso(now))
            log.info("season.private")
            return SeasonLookup("private")
        if exhausted is not None:
            return self._degraded(cached, "quota_exceeded", exhausted)
        log.warning("season.unavailable", status=up.status, code=up.code)
        return self._degraded(cached, "upstream_unavailable", up.retry_after)

    async def _job(self, first: Upstream) -> Upstream:
        """Follow a 202's job until HP has the answer, up to the wait limit (polls are free)."""
        body = first.body if isinstance(first.body, dict) else {}
        job = body.get("job_id")
        if not isinstance(job, str) or not job:
            return Upstream(0, "job_pending", None, first.quota, None)
        waited = 0.0
        s = self._settings
        while waited + s.hp_job_poll_seconds <= s.hp_job_wait_seconds:
            await self._sleep(s.hp_job_poll_seconds)
            waited += s.hp_job_poll_seconds
            up = await self._hp.get(f"/jobs/{job}", {})
            if up.status != 202:
                return up
        log.info("season.job_pending", waited=waited)
        return Upstream(0, "job_pending", None, first.quota, None)

    def _degraded(
        self, cached: CacheEntry | None, notice: Notice, retry_after: float | None
    ) -> SeasonLookup:
        if (
            cached is not None
            and cached.status == 200
            and self._clock() - cached.fetched_at <= self._settings.stale_max_seconds
        ):
            return _from_entry(cached, stale=True, notice=notice)
        outcome: Outcome = "quota_exceeded" if notice == "quota_exceeded" else "unavailable"
        return SeasonLookup(outcome, retry_after=retry_after)


def _d(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _season_of(e: CacheEntry) -> int | None:
    v = e.body.get("season") if isinstance(e.body, dict) else None
    return v if isinstance(v, int) else None


def _from_entry(
    e: CacheEntry, *, stale: bool = False, notice: Notice | None = None
) -> SeasonLookup:
    body = e.body if isinstance(e.body, dict) else {}
    return SeasonLookup(
        "ok",
        _season_of(e),
        list(body.get("heroes") or []),
        e.fetched_at,
        stale=stale,
        notice=notice,
    )

"""A hero's talent tree on one map (영웅 상세, owner 2026-11-05).

HP `/heroes/talents/details?hero=&game_map=&league_tier=` answers every talent of every level
with its games, wins, popularity and win rate: one call per hero, map and bracket, from bucket
`heroes_talents_details` (210/week on Intermediate; the weekly report spends from it too). Asked
when a visitor picks a map on the hero page and kept a week (`talents_ttl_seconds`), so only the
first visitor of a hero, map and bracket waits (~2 s, a 202 job, measured 2026-11-05).

The page names the patch (its `reference_patch`, e.g. 2.57.0); the builds are the server's own
reading of `/patches` (its valid builds of that line, oldest first, the newest five), so a visitor
cannot make up a timeframe and spend the bucket on it. Order as for the season card: fresh cache →
one refresh per key at a time → under the quota guard, HP → past the guard, a kept answer marked
stale → else `quota_exceeded`. A hero HP does not know (422) is `not_found`, not kept.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

import structlog

from server.config import Settings
from server.players import quota
from server.players.hp import HPClient, follow_job
from server.players.service import Notice
from server.players.store import CacheEntry, HPStore

log = structlog.get_logger(__name__)

BUCKET = "heroes_talents_details"  # HP bucket name
PATCHES_KEY = "hp_patch_builds"
PATCHES_TTL = 24 * 3600
LEVELS = ("1", "4", "7", "10", "13", "16", "20")
MAX_BUILDS = 5  # the endpoint takes no more (collector/averages.py)
# Storm League brackets as the builds have them (data/latest/builds.json): 다마그, 브실골플
LEAGUE_TIERS = {"high": "5,6", "low": "1,2,3,4"}
# Bump when a row gains, loses or changes a field: answers kept in another format are asked again.
ROWS_VERSION = 1

Tier = Literal["all", "high", "low"]
Outcome = Literal["ok", "not_found", "unknown_patch", "quota_exceeded", "unavailable"]


@dataclass(frozen=True)
class TalentLookup:
    outcome: Outcome
    builds: str | None = None
    levels: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    fetched_at: float | None = None
    stale: bool = False
    notice: Notice | None = None
    retry_after: float | None = None


def talents_key(hero: str, game_map: str, tier: str, builds: str) -> str:
    return f"hero_talents|{hero}|{game_map}|{tier}|{builds}"


def _version(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in v.split("."))


def builds_of(patches: Any, patch: str) -> str | None:
    """`/patches` → the patch line's valid builds, oldest first, the newest five; None if none."""
    rows = patches.get("patches") if isinstance(patches, dict) else None
    builds = {
        str(p["game_version"])
        for p in (rows if isinstance(rows, list) else [])
        if isinstance(p, dict)
        and p.get("valid_globals") is True
        and isinstance(p.get("game_version"), str)
        and p["game_version"].rsplit(".", 1)[0] == patch
    }
    if not builds:
        return None
    return ",".join(sorted(builds, key=_version)[-MAX_BUILDS:])


def _num(r: dict[str, Any], key: str) -> float:
    v = r.get(key)
    return float(v) if isinstance(v, int | float) and not isinstance(v, bool) else 0.0


def tree(body: Any) -> dict[str, list[dict[str, Any]]]:
    """HP's answer → {level: [{talent, games, wins, popularity, win_rate}]}, most played first."""
    b = body if isinstance(body, dict) else {}
    out: dict[str, list[dict[str, Any]]] = {}
    for level in LEVELS:
        rows = []
        for r in b.get(level) or []:
            info = r.get("talentInfo") if isinstance(r, dict) else None
            name = info.get("talent_name") if isinstance(info, dict) else None
            if not isinstance(name, str):
                continue
            rows.append(
                {
                    "talent": name,
                    "games": int(_num(r, "games_played")),
                    "wins": int(_num(r, "wins")),
                    "popularity": _num(r, "popularity"),
                    "win_rate": _num(r, "win_rate"),
                }
            )
        out[level] = sorted(rows, key=lambda x: (-x["games"], x["talent"]))
    return out


class TalentService:
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
        self._inflight: dict[str, asyncio.Task[TalentLookup]] = {}

    async def lookup(self, hero: str, game_map: str, tier: Tier, patch: str) -> TalentLookup:
        builds = await self._builds(patch)
        if builds is None:
            return TalentLookup("unknown_patch")
        key = talents_key(hero, game_map, tier, builds)
        entry = await self._store.get(key)
        current = entry is not None and _d(entry.body).get("v") == ROWS_VERSION
        if entry is not None and current and entry.expires_at > self._clock():
            return _from_entry(entry)
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.create_task(self._refresh(key, hero, game_map, tier, builds, entry))
            self._inflight[key] = task
            task.add_done_callback(lambda _t: self._inflight.pop(key, None))
        return await asyncio.shield(task)

    async def status(self) -> dict[str, Any]:
        budget = self._settings.talents_daily_budget
        return {BUCKET: await quota.status(self._store, BUCKET, budget, self._clock())}

    async def _builds(self, patch: str) -> str | None:
        cached = await self._store.get(PATCHES_KEY)
        if cached is not None and cached.expires_at > self._clock():
            return builds_of(cached.body, patch)
        up = await self._hp.get("/patches", {})
        if up.status != 200:
            log.warning("talents.patches_unavailable", status=up.status, code=up.code)
            return builds_of(cached.body, patch) if cached is not None else None
        now = self._clock()
        await self._store.put(CacheEntry(PATCHES_KEY, 200, up.body, now, now + PATCHES_TTL))
        return builds_of(up.body, patch)

    async def _refresh(
        self,
        key: str,
        hero: str,
        game_map: str,
        tier: Tier,
        builds: str,
        cached: CacheEntry | None,
    ) -> TalentLookup:
        s = self._settings
        wait = await quota.blocked_for(
            self._store,
            BUCKET,
            floor=s.talents_quota_floor,
            budget=s.talents_daily_budget,
            now=self._clock(),
        )
        if wait is not None:
            return self._degraded(cached, "quota_exceeded", wait)
        params = {
            "timeframe_type": "minor",
            "timeframe": builds,
            "game_type": "sl",
            "hero": hero,
            "game_map": game_map,
        }
        if tier in LEAGUE_TIERS:
            params["league_tier"] = LEAGUE_TIERS[tier]
        up = await self._hp.get("/heroes/talents/details", params)
        now = self._clock()
        await quota.charge(self._store, BUCKET, up, now)
        exhausted = await quota.record(self._store, BUCKET, up, now)
        if up.status == 202:
            up = await follow_job(
                self._hp,
                up,
                poll=s.hp_job_poll_seconds,
                wait=s.hp_job_wait_seconds,
                sleep=self._sleep,
            )
            now = self._clock()
        if up.status == 200:
            levels = tree(up.body)
            body = {"v": ROWS_VERSION, "builds": builds, "levels": levels}
            entry = CacheEntry(key, 200, body, now, now + s.talents_ttl_seconds)
            await self._store.put(entry)
            games = sum(t["games"] for t in levels.get("1", []))
            log.info("talents.live", hero=hero, map=game_map, tier=tier, games=games)
            return _from_entry(entry)
        if up.status == 422:
            log.info("talents.unknown_hero", hero=hero)
            return TalentLookup("not_found")
        if exhausted is not None:
            return self._degraded(cached, "quota_exceeded", exhausted)
        log.warning("talents.unavailable", status=up.status, code=up.code)
        return self._degraded(cached, "upstream_unavailable", up.retry_after)

    def _degraded(
        self, cached: CacheEntry | None, notice: Notice, retry_after: float | None
    ) -> TalentLookup:
        if cached is not None and cached.status == 200 and _d(cached.body).get("v") == ROWS_VERSION:
            return _from_entry(cached, stale=True, notice=notice)
        outcome: Outcome = "quota_exceeded" if notice == "quota_exceeded" else "unavailable"
        return TalentLookup(outcome, retry_after=retry_after)


def _d(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _from_entry(
    e: CacheEntry, *, stale: bool = False, notice: Notice | None = None
) -> TalentLookup:
    body = _d(e.body)
    return TalentLookup(
        "ok",
        body.get("builds"),
        dict(body.get("levels") or {}),
        e.fetched_at,
        stale=stale,
        notice=notice,
    )

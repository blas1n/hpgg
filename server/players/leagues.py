"""A game's league tier from its MMR, the way HP's `/mmr/tier` places a rating.

HP's `/players/mmr/history` lists the game type's league ranges (`league_tiers`): each league as
one row, the player's own league split into five division rows. The ranges are the same for every
player and region (KR and NA, Storm League, 2026-10-13), so one answer per game type serves
everyone for a day. A league's five divisions are equal fifths of it, Master is undivided and a
floor belongs to the league above — checked against `/mmr/tier` (tests/server/test_leagues.py).
`/mmr/tier` itself is one rating per call, at 60 calls a minute: too slow for a list of 100 games.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import structlog

from server.config import Settings
from server.players import quota
from server.players.hp import HPClient
from server.players.store import CacheEntry, HPStore

log = structlog.get_logger(__name__)

HISTORY = "player_mmr_history"  # the HP bucket the ranges are read from
LEAGUES = ("Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master")


def leagues_key(mode: str) -> str:
    return f"leagues|{mode}"


def league_floors(body: Any) -> list[float] | None:
    """The lowest MMR of each of the six leagues, Bronze first; None unless all six are there."""
    rows = body.get("league_tiers") if isinstance(body, dict) else None
    floors: dict[int, float] = {}
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        league, low = r.get("league_tier"), r.get("min_mmr")
        if not isinstance(league, int) or not 1 <= league <= len(LEAGUES):
            continue
        if not isinstance(low, int | float) or isinstance(low, bool):
            continue
        floors[league] = min(float(low), floors.get(league, float(low)))
    if len(floors) != len(LEAGUES):
        return None
    return [floors[i] for i in range(1, len(LEAGUES) + 1)]


def tier_of(mmr: int, floors: list[float]) -> str:
    """The tier name HP uses ("Diamond 2", "Master"); under the lowest floor still Bronze 5."""
    if mmr >= floors[-1]:
        return LEAGUES[-1]
    league = max([i for i, f in enumerate(floors) if mmr >= f], default=0)
    low, high = floors[league], floors[league + 1]
    part = int(max(0.0, mmr - low) * 5 // (high - low))  # ×5 first: integer floors stay exact
    return f"{LEAGUES[league]} {5 - min(part, 4)}"


class LeagueBook:
    """Each game type's league floors, cached a day under one key for every player."""

    def __init__(
        self, *, hp: HPClient, store: HPStore, settings: Settings, clock: Callable[[], float]
    ) -> None:
        self._hp = hp
        self._store = store
        self._settings = settings
        self._clock = clock

    async def learn(self, mode: str, body: Any) -> None:
        """Keep the ranges an MMR history answer for `mode` already carries."""
        floors = league_floors(body)
        if floors is not None:
            await self._put(mode, floors, self._settings.league_ttl_seconds)

    async def floors(self, mode: str, battletag: str, region: str) -> list[float] | None:
        """Fresh floors, else asked of HP through this player's history, else yesterday's."""
        cached = await self._store.get(leagues_key(mode))
        known = _floors(cached)
        now = self._clock()
        if cached is not None and cached.expires_at > now:
            return known
        s = self._settings
        wait = await quota.blocked_for(
            self._store,
            HISTORY,
            floor=s.mmr_history_quota_floor,
            budget=s.mmr_history_daily_budget,
            now=now,
        )
        if wait is not None:
            return known
        params = {"battletag": battletag, "region": region, "game_type": mode}
        up = await self._hp.get("/players/mmr/history", params)
        now = self._clock()
        await quota.record(self._store, HISTORY, up, now)
        await quota.charge(self._store, HISTORY, up, now)
        fresh = league_floors(up.body) if up.status == 200 else None
        if fresh is None:
            log.info("leagues.unavailable", mode=mode, status=up.status, code=up.code)
            # not asked again on every request; the last floors known still serve meanwhile
            await self._put(mode, known, s.league_retry_seconds)
            return known
        await self._put(mode, fresh, s.league_ttl_seconds)
        log.info("leagues.live", mode=mode)
        return fresh

    async def _put(self, mode: str, floors: list[float] | None, ttl: int) -> None:
        now = self._clock()
        body = {"floors": floors}
        await self._store.put(CacheEntry(leagues_key(mode), 200, body, now, now + ttl))


def _floors(e: CacheEntry | None) -> list[float] | None:
    f = e.body.get("floors") if e is not None and isinstance(e.body, dict) else None
    if not isinstance(f, list) or len(f) != len(LEAGUES):
        return None
    return [float(x) for x in f]

"""A member's hero pool (stage C, owner 2026-10-30): a list the member keeps — any hero, by hand,
so a new player with no record can use it — and a sync the member asks for, which pulls this
season's Storm League record from Heroes Profile through the 이번 시즌 card's `SeasonService`
(same cache, daily budget and privacy rules) and adds the heroes played `pool_min_games` times or
more. Heroes played fewer times come back as candidates. Reading or editing the pool never calls
Heroes Profile; only a sync does."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from sqlalchemy import delete, func, select

from server.accounts.models import HeroPoolEntry
from server.config import Settings
from server.db import Database
from server.players.season import SeasonLookup

# Heroes Profile's names: letters (Lúcio), spaces, dots, apostrophes, hyphens (Li-Ming)
HERO_NAME = re.compile(r"^[^\W\d_](?:[\w .'’-]{0,38}[\w.])?$")


def valid_hero(name: str) -> bool:
    return bool(HERO_NAME.match(name))


class Seasons(Protocol):
    async def lookup(self, battletag: str, region: str) -> SeasonLookup: ...


@dataclass(frozen=True)
class Candidate:
    hero: str
    games: int
    wins: int


@dataclass(frozen=True)
class SyncResult:
    status: str
    stale: bool
    season: int | None
    min_games: int
    added: list[str] = field(default_factory=list)
    # the record of each hero in `added`, same order (the page shows "이번 시즌 31판")
    added_records: list[Candidate] = field(default_factory=list)
    candidates: list[Candidate] = field(default_factory=list)


class PoolService:
    def __init__(
        self,
        db: Database,
        settings: Settings,
        seasons: Callable[[], Seasons],
        clock: Callable[[], float],
    ) -> None:
        self._db = db
        self._s = settings
        # read at call time: the season service is created with the app (and swapped in tests)
        self._seasons = seasons
        self._clock = clock

    async def heroes(self, account_id: int) -> list[str]:
        async with self._db.session() as s:
            rows = await s.execute(
                select(HeroPoolEntry.hero)
                .where(HeroPoolEntry.account_id == account_id)
                .order_by(HeroPoolEntry.seq)
            )
            return list(rows.scalars())

    async def set(self, account_id: int, hero: str, include: bool) -> None:
        if include:
            await self._add(account_id, [hero])
            return
        async with self._db.session() as s, s.begin():
            await s.execute(
                delete(HeroPoolEntry).where(
                    HeroPoolEntry.account_id == account_id, HeroPoolEntry.hero == hero
                )
            )

    async def clear(self, account_id: int) -> None:
        async with self._db.session() as s, s.begin():
            await s.execute(delete(HeroPoolEntry).where(HeroPoolEntry.account_id == account_id))

    async def sync(self, account_id: int, battletag: str, region: str) -> SyncResult:
        lookup = await self._seasons().lookup(battletag, region)
        rows: list[dict[str, Any]] = lookup.heroes if lookup.outcome == "ok" else []
        have = set(await self.heroes(account_id))
        played = [r for r in rows if int(r.get("games", 0)) >= self._s.pool_min_games]
        added = await self._add(account_id, [r["hero"] for r in played])
        record = {r["hero"]: r for r in played}
        added_records = [
            Candidate(h, int(record[h].get("games", 0)), int(record[h].get("wins", 0)))
            for h in added
        ]
        candidates = [
            Candidate(r["hero"], int(r.get("games", 0)), int(r.get("wins", 0)))
            for r in rows
            if 0 < int(r.get("games", 0)) < self._s.pool_min_games and r["hero"] not in have
        ]
        return SyncResult(
            status=lookup.outcome,
            stale=lookup.stale,
            season=lookup.season,
            min_games=self._s.pool_min_games,
            added=added,
            added_records=added_records,
            candidates=candidates,
        )

    async def _add(self, account_id: int, heroes: list[str]) -> list[str]:
        """Adds the heroes not in the pool yet, in the given order; returns the ones added."""
        now = self._clock()
        added: list[str] = []
        async with self._db.session() as s, s.begin():
            have = set(
                (
                    await s.execute(
                        select(HeroPoolEntry.hero).where(HeroPoolEntry.account_id == account_id)
                    )
                ).scalars()
            )
            seq = (
                await s.execute(
                    select(func.coalesce(func.max(HeroPoolEntry.seq), 0)).where(
                        HeroPoolEntry.account_id == account_id
                    )
                )
            ).scalar_one()
            for hero in heroes:
                if hero in have:
                    continue
                seq += 1
                have.add(hero)
                added.append(hero)
                s.add(HeroPoolEntry(account_id=account_id, hero=hero, seq=seq, added_at=now))
        return added

"""A member's hero pool: this season's Storm League heroes from Heroes Profile (the 이번 시즌
card's `SeasonService`, so the same cache, budget and privacy rules), at least `pool_min_games`
games, plus the heroes the member added and minus the ones they took out. Choices made by hand
win over the record and stay when HP has nothing for the member."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert

from server.accounts.models import HeroPoolChoice
from server.config import Settings
from server.db import Database
from server.players.season import SeasonLookup

# Heroes Profile's names: letters (Lúcio), spaces, dots, apostrophes, hyphens (Li-Ming)
HERO_NAME = re.compile(r"^[^\W\d_](?:[\w .'’-]{0,38}[\w.])?$")


class Seasons(Protocol):
    async def lookup(self, battletag: str, region: str) -> SeasonLookup: ...


@dataclass(frozen=True)
class PoolHero:
    hero: str
    games: int
    wins: int
    origin: str  # "record" | "added"


@dataclass(frozen=True)
class Pool:
    status: str
    stale: bool
    season: int | None
    min_games: int
    heroes: list[PoolHero] = field(default_factory=list)
    removed: list[PoolHero] = field(default_factory=list)


def valid_hero(name: str) -> bool:
    return bool(HERO_NAME.match(name))


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

    async def get(self, account_id: int, battletag: str, region: str) -> Pool:
        lookup = await self._seasons().lookup(battletag, region)
        rows: dict[str, dict[str, Any]] = (
            {r["hero"]: r for r in lookup.heroes} if lookup.outcome == "ok" else {}
        )
        async with self._db.session() as s:
            choices = {
                c.hero: c.include
                for c in (
                    await s.execute(
                        select(HeroPoolChoice)
                        .where(HeroPoolChoice.account_id == account_id)
                        .order_by(HeroPoolChoice.hero)
                    )
                ).scalars()
            }

        def hero(name: str, origin: str) -> PoolHero:
            r = rows.get(name, {})
            return PoolHero(name, int(r.get("games", 0)), int(r.get("wins", 0)), origin)

        record = [n for n, r in rows.items() if r.get("games", 0) >= self._s.pool_min_games]
        heroes = [hero(n, "record") for n in record if choices.get(n) is not False]
        # added by hand: after the record, by name
        heroes += [hero(n, "added") for n, inc in choices.items() if inc and n not in record]
        removed = [hero(n, "record") for n in record if choices.get(n) is False]
        return Pool(
            status=lookup.outcome,
            stale=lookup.stale,
            season=lookup.season,
            min_games=self._s.pool_min_games,
            heroes=heroes,
            removed=removed,
        )

    async def choose(self, account_id: int, hero: str, include: bool) -> None:
        stmt = insert(HeroPoolChoice).values(
            account_id=account_id, hero=hero, include=include, updated_at=self._clock()
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["account_id", "hero"],
            set_={"include": include, "updated_at": self._clock()},
        )
        async with self._db.session() as s, s.begin():
            await s.execute(stmt)

    async def reset(self, account_id: int) -> None:
        async with self._db.session() as s, s.begin():
            await s.execute(delete(HeroPoolChoice).where(HeroPoolChoice.account_id == account_id))

"""Repository over the hp_* tables (cache, quota readings, daily live-call counts, privacy)."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from typing import Any, Literal

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from server.db import Database
from server.players.hp import Quota
from server.players.models import (
    HPAwardMap,
    HPCache,
    HPDailyUsage,
    HPFeedCursor,
    HPPrivatePlayer,
    HPQuota,
)

PRIVACY_FEED = "player_privacy_changes"  # HP bucket name, also the cursor's row


def player_key(region: str, battletag: str) -> str:
    """Cache key of one /players answer. Region is our code (KR, NA, EU, CN)."""
    return f"players|{region}|{battletag}"


def matches_key(region: str, battletag: str) -> str:
    """Cache key of one player's normalised match list (`server/players/matches.py`)."""
    return f"player_matches|{region}|{battletag}"


def heroes_key(region: str, battletag: str, mode: str) -> str:
    """Cache key of one player's stats per hero for a mode (all, qm, sl; `heroes.py`)."""
    return f"player_heroes|{mode}|{region}|{battletag}"


HERO_MODES = ("all", "qm", "sl")

# Every cache key that holds one player's data — a player going private drops them all.
PLAYER_KEYS: tuple[Callable[[str, str], str], ...] = (
    player_key,
    matches_key,
    *(partial(heroes_key, mode=m) for m in HERO_MODES),
)


@dataclass(frozen=True)
class CacheEntry:
    key: str
    status: int
    body: Any
    fetched_at: float
    expires_at: float


@dataclass(frozen=True)
class PrivacyChange:
    region: str  # our code (KR, NA, EU, CN)
    battletag: str
    state: Literal["private", "public"]
    changed_at: str


@dataclass(frozen=True)
class FeedCursor:
    since: str | None
    after_id: int | None
    last_ok_at: float


class HPStore:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def get(self, key: str) -> CacheEntry | None:
        async with self._db.session() as s:
            row = await s.get(HPCache, key)
        if row is None:
            return None
        body = json.loads(row.body) if row.body is not None else None
        return CacheEntry(row.key, row.status, body, row.fetched_at, row.expires_at)

    async def put(self, e: CacheEntry) -> None:
        values = {
            "key": e.key,
            "status": e.status,
            "body": None if e.body is None else json.dumps(e.body, ensure_ascii=False),
            "fetched_at": e.fetched_at,
            "expires_at": e.expires_at,
        }
        stmt = insert(HPCache).values(**values)
        stmt = stmt.on_conflict_do_update(index_elements=["key"], set_=values)
        async with self._db.session.begin() as s:
            await s.execute(stmt)

    async def quota(self, endpoint: str) -> Quota | None:
        async with self._db.session() as s:
            row = await s.get(HPQuota, endpoint)
        return None if row is None else Quota(row.quota_limit, row.remaining, row.reset_at)

    async def set_quota(self, endpoint: str, q: Quota, now: float) -> None:
        values = {
            "endpoint": endpoint,
            "quota_limit": q.limit,
            "remaining": q.remaining,
            "reset_at": q.reset_at,
            "updated_at": now,
        }
        stmt = insert(HPQuota).values(**values)
        stmt = stmt.on_conflict_do_update(index_elements=["endpoint"], set_=values)
        async with self._db.session.begin() as s:
            await s.execute(stmt)

    async def live_calls(self, day: str, endpoint: str) -> int:
        async with self._db.session() as s:
            n = await s.scalar(
                select(HPDailyUsage.live_calls).where(
                    HPDailyUsage.day == day, HPDailyUsage.endpoint == endpoint
                )
            )
        return n or 0

    async def count_live_call(self, day: str, endpoint: str) -> None:
        stmt = insert(HPDailyUsage).values(day=day, endpoint=endpoint, live_calls=1)
        stmt = stmt.on_conflict_do_update(
            index_elements=["day", "endpoint"],
            set_={"live_calls": HPDailyUsage.live_calls + 1},
        )
        async with self._db.session.begin() as s:
            await s.execute(stmt)

    # --- privacy (HP API terms §5) ---

    async def is_private(self, region: str, battletag: str) -> bool:
        async with self._db.session() as s:
            row = await s.get(HPPrivatePlayer, (region, battletag.lower()))
        return row is not None

    async def mark_private(self, region: str, battletag: str, changed_at: str) -> None:
        """Remember the player as private and drop every cached answer about them."""
        async with self._db.session.begin() as s:
            await _apply(s, PrivacyChange(region, battletag, "private", changed_at))

    async def apply_privacy_page(self, changes: list[PrivacyChange], cursor: FeedCursor) -> None:
        """One feed page and the cursor after it, in one transaction: a crash re-reads the page."""
        async with self._db.session.begin() as s:
            for c in changes:
                await _apply(s, c)
            values = {
                "feed": PRIVACY_FEED,
                "since": cursor.since,
                "after_id": cursor.after_id,
                "last_ok_at": cursor.last_ok_at,
            }
            stmt = insert(HPFeedCursor).values(**values)
            await s.execute(stmt.on_conflict_do_update(index_elements=["feed"], set_=values))

    async def feed_cursor(self) -> FeedCursor | None:
        async with self._db.session() as s:
            row = await s.get(HPFeedCursor, PRIVACY_FEED)
        return None if row is None else FeedCursor(row.since, row.after_id, row.last_ok_at)

    async def purge_fetched_before(self, ts: float) -> int:
        """Drop cached answers HP returned before `ts`; returns how many."""
        async with self._db.session.begin() as s:
            result = await s.execute(delete(HPCache).where(HPCache.fetched_at < ts))
        return int(result.rowcount or 0)  # type: ignore[attr-defined]

    # --- awards HP names by an id the shipped table lacks (server/players/awards.py) ---

    async def learned_award(self, award_id: str) -> str | None:
        async with self._db.session() as s:
            row = await s.get(HPAwardMap, award_id)
        return None if row is None else row.award_key

    async def learned_awards(self) -> dict[str, str]:
        async with self._db.session() as s:
            rows = (await s.execute(select(HPAwardMap))).scalars().all()
        return {r.award_id: r.award_key for r in rows}

    async def learn_award(self, award_id: str, key: str, title: str, now: float) -> None:
        values = {"award_id": award_id, "award_key": key, "title": title, "learned_at": now}
        stmt = insert(HPAwardMap).values(**values).on_conflict_do_nothing()
        async with self._db.session.begin() as s:
            await s.execute(stmt)


async def _apply(s: AsyncSession, c: PrivacyChange) -> None:
    lc = c.battletag.lower()
    if c.state == "public":
        await s.execute(
            delete(HPPrivatePlayer).where(
                HPPrivatePlayer.region == c.region, HPPrivatePlayer.battletag_lc == lc
            )
        )
        return
    values = {"region": c.region, "battletag_lc": lc, "changed_at": c.changed_at}
    stmt = insert(HPPrivatePlayer).values(**values)
    await s.execute(
        stmt.on_conflict_do_update(index_elements=["region", "battletag_lc"], set_=values)
    )
    # a visitor may have typed the tag in any letter case, and each spelling is its own key
    keys = [k(c.region, lc).lower() for k in PLAYER_KEYS]
    await s.execute(delete(HPCache).where(func.lower(HPCache.key).in_(keys)))

"""Repository over the hp_* tables (cache entries, quota readings, daily live-call counts)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert

from server.db import Database
from server.players.hp import Quota
from server.players.models import HPCache, HPDailyUsage, HPQuota


@dataclass(frozen=True)
class CacheEntry:
    key: str
    status: int
    body: Any
    fetched_at: float
    expires_at: float


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

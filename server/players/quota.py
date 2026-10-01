"""When a live HP call is allowed, per endpoint bucket — shared by every player-data service.

HP's own reading first (stop at `floor` left in the rolling week, or after a 429 quota_exceeded
until its Retry-After), then our daily budget (live calls per UTC day), so one busy day cannot
spend the whole week.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from server.players.hp import Quota, Upstream
from server.players.store import HPStore


def day(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d")


def until_tomorrow(ts: float) -> float:
    now = datetime.fromtimestamp(ts, UTC)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return (tomorrow - now).total_seconds()


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


async def blocked_for(
    store: HPStore, endpoint: str, *, floor: int, budget: int, now: float
) -> float | None:
    """Seconds until live calls may resume, or None when they are allowed now."""
    q = await store.quota(endpoint)
    if q is not None and q.remaining <= floor and q.reset_at > now:
        return q.reset_at - now
    if await store.live_calls(day(now), endpoint) >= budget:
        return until_tomorrow(now)
    return None


async def record(store: HPStore, endpoint: str, up: Upstream, now: float) -> float | None:
    """Store the quota reading; on 429 quota_exceeded mark the bucket empty and return the wait."""
    if up.quota is not None:
        await store.set_quota(endpoint, up.quota, now)
    if up.status == 429 and up.code == "quota_exceeded":
        reset = now + (up.retry_after if up.retry_after is not None else 3600.0)
        limit = up.quota.limit if up.quota else 0
        await store.set_quota(endpoint, Quota(limit, 0, reset), now)
        return reset - now
    return None


async def status(store: HPStore, endpoint: str, budget: int, now: float) -> dict[str, object]:
    q = await store.quota(endpoint)
    return {
        "limit": q.limit if q else None,
        "remaining": q.remaining if q else None,
        "reset_at": iso(q.reset_at) if q else None,
        "live_calls_today": await store.live_calls(day(now), endpoint),
        "daily_budget": budget,
    }

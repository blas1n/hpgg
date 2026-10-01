"""Heroes Profile's privacy change feed (API terms §5, read 2026-10-01).

The terms: poll the feed at least once every 24 hours; within 24 hours of a player going private,
stop showing their data and remove it from every cache; honour a takedown HP passes on within
7 days. HP itself refuses a private player from then on (403 `player_unavailable`), so what is
left to us is what we already hold: this poller marks the player private and deletes their cached
answers, and each poll also drops every answer older than `stale_max_seconds`, so nothing we keep
can outlive the rule even while the feed is unreachable.

GET /players/privacy/changes?since=&after_id=&limit= → {changes: [{battletag, region, state,
changed_at}], next_since, next_after_id, has_more}. No `since` = first sync (every account that
ever changed). Own bucket `player_privacy_changes`, 10,080/week on Basic; an hourly poll uses 168.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import structlog

from server.config import Settings
from server.players.hp import HPClient
from server.players.store import PRIVACY_FEED, FeedCursor, HPStore, PrivacyChange

log = structlog.get_logger(__name__)

PATH = "/players/privacy/changes"
PAGE_SIZE = 5000  # the most HP allows
MAX_PAGES = 200  # a runaway guard: 1,000,000 changes in one poll
# HP region ids (docs "Variables"): NA/1, EU/2, KR/3, CN/5.
REGIONS = {1: "NA", 2: "EU", 3: "KR", 5: "CN"}


class PrivacyFeed:
    def __init__(
        self, *, hp: HPClient, store: HPStore, settings: Settings, clock: Callable[[], float]
    ) -> None:
        self._hp = hp
        self._store = store
        self._settings = settings
        self._clock = clock

    async def poll_once(self) -> bool:
        """Read the feed to its end and apply it. False when HP did not answer usably."""
        cursor = await self._store.feed_cursor()
        since = cursor.since if cursor else None
        after_id = cursor.after_id if cursor else None
        applied = 0
        for _ in range(MAX_PAGES):
            params = {"limit": str(PAGE_SIZE)}
            if since is not None:
                params["since"] = since
            if after_id is not None:
                params["after_id"] = str(after_id)
            up = await self._hp.get(PATH, params)
            if up.quota is not None:
                await self._store.set_quota(PRIVACY_FEED, up.quota, self._clock())
            page = _page(up.body) if up.status == 200 else None
            if page is None:
                log.warning("privacy.poll_failed", status=up.status, code=up.code)
                return False
            changes, since, after_id, has_more = page
            await self._store.apply_privacy_page(
                changes, FeedCursor(since, after_id, self._clock())
            )
            applied += len(changes)
            if not has_more:
                break
        purged = await self._store.purge_fetched_before(
            self._clock() - self._settings.stale_max_seconds
        )
        log.info("privacy.polled", changes=applied, purged=purged)
        return True

    async def run_forever(self) -> None:
        """Poll now, then every `privacy_poll_seconds`. A failure waits for the next turn."""
        while True:
            try:
                await self.poll_once()
            except Exception:  # noqa: BLE001 — the loop must outlive one bad poll
                log.exception("privacy.poll_crashed")
            await asyncio.sleep(self._settings.privacy_poll_seconds)

    async def status(self) -> dict[str, Any]:
        cursor = await self._store.feed_cursor()
        q = await self._store.quota(PRIVACY_FEED)
        return {
            "last_ok_at": _iso(cursor.last_ok_at) if cursor else None,
            "since": cursor.since if cursor else None,
            "remaining": q.remaining if q else None,
        }


def _page(body: Any) -> tuple[list[PrivacyChange], str, int, bool] | None:
    try:
        rows = body["changes"]
        since, after_id, has_more = (
            str(body["next_since"]),
            int(body["next_after_id"]),
            body["has_more"],
        )
    except (KeyError, TypeError, ValueError):
        return None
    if not isinstance(rows, list) or not isinstance(has_more, bool):
        return None
    changes: list[PrivacyChange] = []
    for row in rows:
        c = _change(row)
        if c is None:
            log.warning(
                "privacy.change_skipped", region=_get(row, "region"), state=_get(row, "state")
            )
        else:
            changes.append(c)
    return changes, since, after_id, has_more


def _change(row: Any) -> PrivacyChange | None:
    if not isinstance(row, dict):
        return None
    region = REGIONS.get(row.get("region"))  # type: ignore[arg-type]
    state, tag = row.get("state"), row.get("battletag")
    if region is None or state not in ("private", "public") or not isinstance(tag, str):
        return None
    return PrivacyChange(region, tag, state, str(row.get("changed_at", "")))


def _get(row: Any, key: str) -> Any:
    return row.get(key) if isinstance(row, dict) else None


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

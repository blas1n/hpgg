"""Heroes Profile API terms §5: poll the privacy change feed, drop players who went private.

Feed: GET /players/privacy/changes?since=&after_id=&limit= → {changes: [{battletag, region (HP id),
state, changed_at}], next_since, next_after_id, has_more}. Shape recorded 2026-10-01.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

from server.config import Settings
from server.db import Database, migrate
from server.players.hp import HPClient
from server.players.privacy import PrivacyFeed
from server.players.service import PlayerService
from server.players.store import CacheEntry, HPStore
from tests.server.conftest import BASE, TOKEN, Clock, FakeHP, hp_response, recorded

FEED = "/players/privacy/changes"


@pytest.fixture
async def db(settings: Settings) -> AsyncIterator[Database]:
    migrate(settings.db_path)
    database = Database(settings.db_path)
    yield database
    await database.dispose()


def _hp(fake: FakeHP, clock: Clock) -> HPClient:
    return HPClient(
        base_url=BASE, token=TOKEN, http=httpx.AsyncClient(transport=fake.transport), clock=clock
    )


@pytest.fixture
def feed(db: Database, fake_hp: FakeHP, clock: Clock, settings: Settings) -> PrivacyFeed:
    return PrivacyFeed(hp=_hp(fake_hp, clock), store=HPStore(db), settings=settings, clock=clock)


@pytest.fixture
def svc(db: Database, fake_hp: FakeHP, clock: Clock, settings: Settings) -> PlayerService:
    return PlayerService(hp=_hp(fake_hp, clock), store=HPStore(db), settings=settings, clock=clock)


def page(
    changes: list[dict[str, Any]],
    *,
    has_more: bool = False,
    next_since: str = "2026-10-01T00:00:00+00:00",
    next_after_id: int = 1,
) -> httpx.Response:
    body = {
        "changes": changes,
        "next_since": next_since,
        "next_after_id": next_after_id,
        "has_more": has_more,
    }
    return httpx.Response(200, json=body)


def change(battletag: str, region: int, state: str = "private") -> dict[str, Any]:
    return {
        "battletag": battletag,
        "region": region,
        "state": state,
        "changed_at": "2026-10-01T00:00:00+00:00",
    }


def feed_requests(fake: FakeHP) -> list[httpx.Request]:
    return [r for r in fake.requests if r.url.path.endswith(FEED)]


async def cache_player(store: HPStore, battletag: str, region: str, clock: Clock) -> str:
    key = f"players|{region}|{battletag}"
    body = recorded("v1_players_200.json")["body"]
    await store.put(CacheEntry(key, 200, body, clock.now, clock.now + 3600))
    return key


async def test_first_sync_reads_every_page_and_marks_players_private(
    feed: PrivacyFeed, fake_hp: FakeHP, db: Database
) -> None:
    second = page([change("Late#1111", 3)], next_since="2026-10-01T01:00:00+00:00", next_after_id=7)
    answers = iter([hp_response("v1_privacy_changes_200.json"), second])
    fake_hp.responder = lambda r: next(answers)

    assert await feed.poll_once() is True

    first, then = feed_requests(fake_hp)
    assert "since" not in first.url.params  # first sync: everything that ever changed
    assert int(first.url.params["limit"]) >= 1000
    assert then.url.params["since"] == "2026-09-01T00:00:00+00:00"
    assert then.url.params["after_id"] == "319"
    store = HPStore(db)
    assert await store.is_private("EU", "Player13#1013")
    assert await store.is_private("NA", "Player14#1014")
    assert await store.is_private("KR", "Late#1111")
    assert not await store.is_private("KR", "Player13#1013")  # regions are separate accounts
    cursor = await store.feed_cursor()
    assert cursor is not None
    assert (cursor.since, cursor.after_id) == ("2026-10-01T01:00:00+00:00", 7)


async def test_next_poll_continues_from_the_saved_cursor(
    feed: PrivacyFeed, fake_hp: FakeHP
) -> None:
    fake_hp.responder = lambda r: page([], next_since="2026-10-01T05:00:00+00:00", next_after_id=42)
    await feed.poll_once()
    await feed.poll_once()
    later = feed_requests(fake_hp)[1]
    assert later.url.params["since"] == "2026-10-01T05:00:00+00:00"
    assert later.url.params["after_id"] == "42"


async def test_going_private_removes_the_cached_profile_in_any_letter_case(
    feed: PrivacyFeed, fake_hp: FakeHP, db: Database, clock: Clock
) -> None:
    store = HPStore(db)
    typed = await cache_player(store, "player13#1013", "EU", clock)  # as a visitor typed it
    kept = await cache_player(store, "Someone#1234", "EU", clock)
    fake_hp.responder = lambda r: page([change("Player13#1013", 2)])
    await feed.poll_once()
    assert await store.get(typed) is None
    assert await store.get(kept) is not None


async def test_a_private_player_is_not_served_from_cache_nor_asked_again(
    feed: PrivacyFeed, svc: PlayerService, fake_hp: FakeHP, db: Database, clock: Clock
) -> None:
    fake_hp.responder = lambda r: page([change("Player13#1013", 2)])
    await feed.poll_once()
    asked = len(fake_hp.requests)
    r = await svc.lookup("PLAYER13#1013", "EU")
    assert r.outcome == "private" and r.profile is None
    assert len(fake_hp.requests) == asked


async def test_going_public_again_lets_the_player_be_looked_up(
    feed: PrivacyFeed, svc: PlayerService, fake_hp: FakeHP, db: Database
) -> None:
    answers = iter(
        [page([change("Player13#1013", 2)]), page([change("Player13#1013", 2, "public")])]
    )
    fake_hp.responder = lambda r: next(answers)
    await feed.poll_once()
    await feed.poll_once()
    assert not await HPStore(db).is_private("EU", "Player13#1013")
    fake_hp.responder = lambda r: hp_response("v1_players_200.json")
    assert (await svc.lookup("Player13#1013", "EU")).outcome == "ok"


async def test_changes_apply_in_feed_order(
    feed: PrivacyFeed, fake_hp: FakeHP, db: Database
) -> None:
    fake_hp.responder = lambda r: page(
        [change("Flip#1000", 1), change("Flip#1000", 1, "public"), change("Flip#1000", 1)]
    )
    await feed.poll_once()
    assert await HPStore(db).is_private("NA", "Flip#1000")


async def test_unknown_region_or_state_is_skipped_not_fatal(
    feed: PrivacyFeed, fake_hp: FakeHP, db: Database
) -> None:
    fake_hp.responder = lambda r: page(
        [change("Odd#1000", 9), change("Odd#2000", 1, "hidden"), change("Ok#3000", 5)]
    )
    assert await feed.poll_once() is True
    store = HPStore(db)
    assert not await store.is_private("NA", "Odd#2000")
    assert await store.is_private("CN", "Ok#3000")


@pytest.mark.parametrize(
    "resp",
    [
        httpx.Response(500, json={"error": {"code": "server_error", "message": "x"}}),
        httpx.Response(200, json={"unexpected": True}),
    ],
)
async def test_a_failed_poll_keeps_the_cursor_and_reports_failure(
    feed: PrivacyFeed, fake_hp: FakeHP, db: Database, resp: httpx.Response
) -> None:
    fake_hp.responder = lambda r: page([], next_since="2026-10-01T05:00:00+00:00", next_after_id=42)
    await feed.poll_once()
    fake_hp.responder = lambda r: resp
    assert await feed.poll_once() is False
    cursor = await HPStore(db).feed_cursor()
    assert cursor is not None and cursor.after_id == 42


async def test_a_poll_drops_profiles_older_than_the_stale_limit(
    feed: PrivacyFeed, fake_hp: FakeHP, db: Database, clock: Clock, settings: Settings
) -> None:
    store = HPStore(db)
    old = await cache_player(store, "Old#1000", "KR", clock)
    clock.now += settings.stale_max_seconds - 60
    recent = await cache_player(store, "New#2000", "KR", clock)
    clock.now += 120
    fake_hp.responder = lambda r: page([])
    await feed.poll_once()
    assert await store.get(old) is None
    assert await store.get(recent) is not None


async def test_the_feed_quota_is_recorded_under_its_own_bucket(
    feed: PrivacyFeed, fake_hp: FakeHP, db: Database, clock: Clock
) -> None:
    answers = iter([hp_response("v1_privacy_changes_200.json"), page([])])
    fake_hp.responder = lambda r: next(answers)
    await feed.poll_once()
    q = await HPStore(db).quota("player_privacy_changes")
    assert q is not None and q.limit == 10080
    assert await HPStore(db).quota("players") is None
    status = await feed.status()
    assert status["last_ok_at"] is not None and status["since"] == "2026-10-01T00:00:00+00:00"


def test_the_feed_is_polled_well_inside_the_24_hour_rule() -> None:
    s = Settings(hp_api_token="x", _env_file=None)  # type: ignore[arg-type, call-arg]
    assert 0 < s.privacy_poll_seconds <= 6 * 3600
    assert s.stale_max_seconds <= 24 * 3600

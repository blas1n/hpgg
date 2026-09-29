"""Player lookups: cache, TTLs, coalescing, quota tracking and explicit degradation."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import httpx
import pytest

from server.config import Settings
from server.db import Database, migrate
from server.players.hp import HPClient
from server.players.service import PlayerService
from server.players.store import HPStore
from tests.server.conftest import BASE, TOKEN, Clock, FakeHP, hp_response

TAG, REGION = "Player12#1012", "NA"


@pytest.fixture
async def db(settings: Settings) -> AsyncIterator[Database]:
    migrate(settings.db_path)
    database = Database(settings.db_path)
    yield database
    await database.dispose()


def make_service(settings: Settings, db: Database, fake: FakeHP, clock: Clock) -> PlayerService:
    hp = HPClient(
        base_url=BASE, token=TOKEN, http=httpx.AsyncClient(transport=fake.transport), clock=clock
    )
    return PlayerService(hp=hp, store=HPStore(db), settings=settings, clock=clock)


@pytest.fixture
def svc(settings: Settings, db: Database, fake_hp: FakeHP, clock: Clock) -> PlayerService:
    return make_service(settings, db, fake_hp, clock)


def quota_429(retry_after: str = "7200") -> httpx.Response:
    return httpx.Response(
        429,
        json={"error": {"code": "quota_exceeded", "message": "allowance used"}},
        headers={"Retry-After": retry_after},
    )


async def test_live_then_cached(svc: PlayerService, fake_hp: FakeHP, clock: Clock) -> None:
    first = await svc.lookup(TAG, REGION)
    assert first.outcome == "ok" and first.source == "live" and not first.stale
    assert first.profile is not None and first.profile["account_level"] == 1802
    assert first.profile["battletag"] == TAG and first.profile["region"] == REGION
    assert fake_hp.requests[0].url.params["region"] == "NA"
    clock.now += 60
    second = await svc.lookup(TAG, REGION)
    assert second.outcome == "ok" and second.source == "cache"
    assert second.fetched_at == first.fetched_at
    assert len(fake_hp.requests) == 1


async def test_cache_survives_a_new_service(
    settings: Settings, db: Database, fake_hp: FakeHP, clock: Clock
) -> None:
    await make_service(settings, db, fake_hp, clock).lookup(TAG, REGION)
    again = await make_service(settings, db, fake_hp, clock).lookup(TAG, REGION)
    assert again.source == "cache" and len(fake_hp.requests) == 1


async def test_expired_entry_is_refetched(
    svc: PlayerService, fake_hp: FakeHP, clock: Clock, settings: Settings
) -> None:
    await svc.lookup(TAG, REGION)
    clock.now += settings.player_ttl_seconds + 1
    r = await svc.lookup(TAG, REGION)
    assert r.source == "live" and len(fake_hp.requests) == 2


async def test_regions_are_separate_keys(svc: PlayerService, fake_hp: FakeHP) -> None:
    await svc.lookup(TAG, "NA")
    await svc.lookup(TAG, "KR")
    assert len(fake_hp.requests) == 2


async def test_not_found_is_cached_for_its_own_ttl(
    svc: PlayerService, fake_hp: FakeHP, clock: Clock, settings: Settings
) -> None:
    fake_hp.responder = lambda r: hp_response("v1_players_404.json")
    assert (await svc.lookup("Nobody#1", "KR")).outcome == "not_found"
    assert (await svc.lookup("Nobody#1", "KR")).outcome == "not_found"
    assert len(fake_hp.requests) == 1
    clock.now += settings.not_found_ttl_seconds + 1
    await svc.lookup("Nobody#1", "KR")
    assert len(fake_hp.requests) == 2


async def test_concurrent_identical_lookups_share_one_call(
    svc: PlayerService, fake_hp: FakeHP
) -> None:
    gate = asyncio.Event()

    async def slow(request: httpx.Request) -> httpx.Response:
        fake_hp.requests.append(request)
        await gate.wait()
        return hp_response("v1_players_200.json")

    svc._hp._http = httpx.AsyncClient(transport=httpx.MockTransport(slow))  # type: ignore[attr-defined]
    tasks = [asyncio.create_task(svc.lookup(TAG, REGION)) for _ in range(5)]
    await asyncio.sleep(0.05)
    gate.set()
    results = await asyncio.gather(*tasks)
    assert len(fake_hp.requests) == 1
    assert all(r.outcome == "ok" for r in results)


async def test_quota_headers_are_tracked_and_persisted(
    svc: PlayerService, db: Database, clock: Clock
) -> None:
    await svc.lookup(TAG, REGION)
    q = await HPStore(db).quota("players")
    assert q is not None and q.remaining == 9999 and q.limit == 10000
    status = await svc.status()
    assert status["players"]["remaining"] == 9999
    assert status["players"]["live_calls_today"] == 1


async def test_hp_quota_exceeded_serves_stale_then_stops_calling(
    svc: PlayerService, fake_hp: FakeHP, clock: Clock, settings: Settings
) -> None:
    await svc.lookup(TAG, REGION)
    clock.now += settings.player_ttl_seconds + 1
    fake_hp.responder = lambda r: quota_429()
    stale = await svc.lookup(TAG, REGION)
    assert stale.outcome == "ok" and stale.stale and stale.notice == "quota_exceeded"
    assert stale.profile is not None and stale.profile["account_level"] == 1802
    # another player: nothing cached → explicit quota state, and HP is not asked again
    other = await svc.lookup("Other#1234", REGION)
    assert other.outcome == "quota_exceeded" and other.retry_after is not None
    assert other.retry_after <= 7200
    assert len(fake_hp.requests) == 2
    # after the reset HP is asked again
    clock.now += 7201
    fake_hp.responder = lambda r: hp_response("v1_players_200.json")
    assert (await svc.lookup("Other#1234", REGION)).source == "live"


async def test_remaining_at_the_floor_stops_live_calls(
    svc: PlayerService, fake_hp: FakeHP, settings: Settings
) -> None:
    fake_hp.responder = lambda r: hp_response(
        "v1_players_200.json", **{"x-hp-quota-remaining": str(settings.quota_floor)}
    )
    assert (await svc.lookup(TAG, REGION)).outcome == "ok"
    r = await svc.lookup("Other#1234", REGION)
    assert r.outcome == "quota_exceeded"
    assert len(fake_hp.requests) == 1


async def test_daily_budget_stops_live_calls_until_tomorrow(
    settings: Settings, db: Database, fake_hp: FakeHP, clock: Clock
) -> None:
    settings.daily_live_budget = 2
    svc = make_service(settings, db, fake_hp, clock)
    await svc.lookup("A#1111", REGION)
    await svc.lookup("B#2222", REGION)
    r = await svc.lookup("C#3333", REGION)
    assert r.outcome == "quota_exceeded"
    assert r.retry_after is not None and 0 < r.retry_after <= 86400
    assert len(fake_hp.requests) == 2
    clock.now += 86400
    assert (await svc.lookup("C#3333", REGION)).outcome == "ok"


async def test_errors_are_not_counted_against_the_daily_budget(
    settings: Settings, db: Database, fake_hp: FakeHP, clock: Clock
) -> None:
    settings.daily_live_budget = 1
    svc = make_service(settings, db, fake_hp, clock)
    fake_hp.responder = lambda r: hp_response("v1_players_404.json")
    await svc.lookup("Nobody#1", REGION)
    fake_hp.responder = lambda r: hp_response("v1_players_200.json")
    assert (await svc.lookup(TAG, REGION)).outcome == "ok"


@pytest.mark.parametrize(
    "resp",
    [
        httpx.Response(500, json={"error": {"code": "server_error", "message": "x"}}),
        httpx.Response(
            429,
            json={"error": {"code": "rate_limited", "message": "slow down"}},
            headers={"Retry-After": "30"},
        ),
    ],
)
async def test_upstream_trouble_serves_stale_or_unavailable(
    svc: PlayerService,
    fake_hp: FakeHP,
    clock: Clock,
    settings: Settings,
    resp: httpx.Response,
) -> None:
    await svc.lookup(TAG, REGION)
    clock.now += settings.player_ttl_seconds + 1
    fake_hp.responder = lambda r: resp
    stale = await svc.lookup(TAG, REGION)
    assert stale.outcome == "ok" and stale.stale and stale.notice == "upstream_unavailable"
    fresh = await svc.lookup("Other#1234", REGION)
    assert fresh.outcome == "unavailable"


async def test_transport_error_is_unavailable(svc: PlayerService, fake_hp: FakeHP) -> None:
    def boom(r: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    fake_hp.responder = boom
    assert (await svc.lookup(TAG, REGION)).outcome == "unavailable"


async def test_unexpected_4xx_is_unavailable_and_not_cached(
    svc: PlayerService, fake_hp: FakeHP
) -> None:
    fake_hp.responder = lambda r: hp_response("v1_players_422.json")
    assert (await svc.lookup(TAG, REGION)).outcome == "unavailable"
    await svc.lookup(TAG, REGION)
    assert len(fake_hp.requests) == 2


def test_not_found_is_retried_soon_after_an_upload() -> None:
    # HP answers 404 for free; a long cache only hides games someone just uploaded.
    from server.config import Settings

    assert Settings(hp_api_token="x").not_found_ttl_seconds <= 600

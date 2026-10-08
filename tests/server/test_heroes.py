"""A player's stats per hero (전적 검색, #88; owner 2026-10-02 on Intermediate).

HP `/players/heroes` (bucket player_hero_all, 25/week on Basic, 500 on Intermediate) answers one
row per hero the player has played: wins, losses, KDA, per-game averages, MMR per mode. Every
game type by default; `game_type` narrows it. Shape recorded 2026-10-02.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.config import Settings
from server.db import Database, migrate
from server.players.heroes import HeroStatsService
from server.players.hp import HPClient
from server.players.store import CacheEntry, HPStore, heroes_key
from tests.server.conftest import BASE, TOKEN, Clock, FakeHP, hp_response

TAG, REGION = "blAs1N#3479", "KR"


@pytest.fixture
async def db(settings: Settings) -> AsyncIterator[Database]:
    migrate(settings.db_path)
    database = Database(settings.db_path)
    yield database
    await database.dispose()


class Sleeper:
    def __init__(self, clock: Clock) -> None:
        self.clock = clock

    async def __call__(self, seconds: float) -> None:
        self.clock.now += seconds


@pytest.fixture
def store(db: Database) -> HPStore:
    return HPStore(db)


@pytest.fixture
def svc(settings: Settings, store: HPStore, fake_hp: FakeHP, clock: Clock) -> HeroStatsService:
    hp = HPClient(
        base_url=BASE, token=TOKEN, http=httpx.AsyncClient(transport=fake_hp.transport), clock=clock
    )
    return HeroStatsService(
        hp=hp, store=store, settings=settings, clock=clock, sleep=Sleeper(clock)
    )


def heroes_ok(_r: httpx.Request) -> httpx.Response:
    return hp_response("v1_players_heroes_200.json")


def quota_429() -> httpx.Response:
    return httpx.Response(
        429,
        json={"error": {"code": "quota_exceeded", "message": "week"}},
        headers={"x-hp-quota-limit": "500", "x-hp-quota-remaining": "0", "retry-after": "500000"},
    )


async def test_rows_per_hero_most_played_first(svc: HeroStatsService, fake_hp: FakeHP) -> None:
    fake_hp.responder = heroes_ok
    r = await svc.lookup(TAG, REGION, "all")
    assert r.outcome == "ok"
    assert [h["hero"] for h in r.heroes] == ["Alarak", "Chen", "Greymane"]
    alarak = r.heroes[0]
    assert alarak == {
        "hero": "Alarak",
        "short_name": "alarak",
        "games": 9,
        "wins": 4,
        "losses": 5,
        "win_rate": 44.44,
        "kda": 5.58,
        "kills": 4.78,
        "deaths": 2.67,
        "assists": 10.0,
        "hero_damage": 45686.11,
        "siege_damage": 57353.44,
        "healing": 0.0,
        "damage_taken": 49465.0,
        "experience": 10656.44,
    }
    q = dict(fake_hp.requests[0].url.params)
    assert q == {"battletag": TAG, "region": REGION}  # every game type: no game_type


async def test_a_mode_narrows_the_query_and_is_cached_on_its_own(
    svc: HeroStatsService, fake_hp: FakeHP
) -> None:
    fake_hp.responder = heroes_ok
    await svc.lookup(TAG, REGION, "sl")
    assert dict(fake_hp.requests[-1].url.params)["game_type"] == "sl"
    await svc.lookup(TAG, REGION, "sl")
    assert len(fake_hp.requests) == 1  # cached
    await svc.lookup(TAG, REGION, "qm")
    assert dict(fake_hp.requests[-1].url.params)["game_type"] == "qm"
    assert len(fake_hp.requests) == 2


async def test_a_cold_query_is_polled_until_hp_has_it(
    svc: HeroStatsService, fake_hp: FakeHP
) -> None:
    answers = iter(
        [
            httpx.Response(202, json={"async": True, "status": "processing", "job_id": "j"}),
            hp_response("v1_players_heroes_200.json"),
        ]
    )
    fake_hp.responder = lambda _r: next(answers)
    r = await svc.lookup(TAG, REGION, "all")
    assert r.outcome == "ok" and len(r.heroes) == 3
    # HP charges the 202 as well (2026-10-08)
    assert (await svc.status())["player_hero_all"]["live_calls_today"] == 2


async def test_unknown_and_private_players(
    svc: HeroStatsService, fake_hp: FakeHP, store: HPStore
) -> None:
    fake_hp.responder = lambda _r: httpx.Response(
        404, json={"error": {"code": "not_found", "message": "x"}}
    )
    assert (await svc.lookup(TAG, REGION, "all")).outcome == "not_found"
    fake_hp.responder = lambda _r: httpx.Response(
        403, json={"error": {"code": "player_unavailable", "message": "x"}}
    )
    assert (await svc.lookup("Other#1234", REGION, "all")).outcome == "private"
    assert await store.is_private(REGION, "Other#1234")
    n = len(fake_hp.requests)
    assert (await svc.lookup("Other#1234", REGION, "qm")).outcome == "private"
    assert len(fake_hp.requests) == n  # a private player costs no call


async def test_over_the_budget_a_recent_answer_is_served_stale_else_quota(
    svc: HeroStatsService, fake_hp: FakeHP, clock: Clock, settings: Settings
) -> None:
    fake_hp.responder = heroes_ok
    await svc.lookup(TAG, REGION, "all")
    clock.now += settings.hero_stats_ttl_seconds + 1  # expired, still within a day
    fake_hp.responder = lambda _r: quota_429()
    r = await svc.lookup(TAG, REGION, "all")
    assert (r.outcome, r.stale, r.notice) == ("ok", True, "quota_exceeded")
    assert (await svc.lookup("Fresh#1111", REGION, "all")).outcome == "quota_exceeded"


async def test_a_player_going_private_drops_every_mode(store: HPStore, clock: Clock) -> None:
    for mode in ("all", "qm", "sl"):
        await store.put(CacheEntry(heroes_key(REGION, TAG, mode), 200, {"heroes": []}, 1, 2))
    await store.mark_private(REGION, TAG.lower(), "2026-10-02T00:00:00Z")
    for mode in ("all", "qm", "sl"):
        assert await store.get(heroes_key(REGION, TAG, mode)) is None


@pytest.fixture
def client(settings: Settings, fake_hp: FakeHP, clock: Clock) -> Iterator[TestClient]:
    app = create_app(settings, hp_transport=fake_hp.transport, clock=clock, privacy_poll=False)
    with TestClient(app) as c:
        yield c


def test_route(client: TestClient, fake_hp: FakeHP) -> None:
    fake_hp.responder = heroes_ok
    r = client.get("/v1/players/heroes", params={"battletag": TAG, "region": REGION, "mode": "sl"})
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "sl" and body["heroes"][0]["hero"] == "Alarak"
    assert set(body) == {"mode", "heroes", "fetched_at", "stale", "notice"}
    bad = client.get(
        "/v1/players/heroes", params={"battletag": TAG, "region": REGION, "mode": "ar"}
    )
    assert bad.status_code == 422

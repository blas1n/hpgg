"""A player's Storm League heroes this season (이번 시즌 card, owner 2026-10-14).

HP `/players/heroes?season=<current>&game_type=sl` (bucket player_hero_all, 500/week on
Intermediate) answers one row per hero with games, wins, losses and the season's sums of kills,
deaths, assists and takedowns — every game HP has, with no cap like the match list's 100. A cold
query answers 202 with a job id; `/jobs/{id}` answers without an X-HP-Quota reading, so polling
it is not charged (measured 2026-10-14: the 202 took 500 → 499, the job's 200 had no reading).
The current season is the newest one in `/patches`. Shapes recorded 2026-10-14.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.config import Settings
from server.db import Database, migrate
from server.players.hp import HPClient
from server.players.season import BUCKET, SeasonService
from server.players.store import CacheEntry, HPStore, season_key
from tests.server.conftest import BASE, TOKEN, Clock, FakeHP, hp_response

TAG, REGION = "blAs1N#3479", "KR"
Responder = Callable[[httpx.Request], httpx.Response]


@pytest.fixture
async def db(settings: Settings) -> AsyncIterator[Database]:
    migrate(settings.db_path)
    database = Database(settings.db_path)
    yield database
    await database.dispose()


class Sleeper:
    def __init__(self, clock: Clock) -> None:
        self.clock = clock
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)
        self.clock.now += seconds


@pytest.fixture
def store(db: Database) -> HPStore:
    return HPStore(db)


@pytest.fixture
def sleeper(clock: Clock) -> Sleeper:
    return Sleeper(clock)


@pytest.fixture
def svc(
    settings: Settings, store: HPStore, fake_hp: FakeHP, clock: Clock, sleeper: Sleeper
) -> SeasonService:
    hp = HPClient(
        base_url=BASE, token=TOKEN, http=httpx.AsyncClient(transport=fake_hp.transport), clock=clock
    )
    return SeasonService(hp=hp, store=store, settings=settings, clock=clock, sleep=sleeper)


def route(*, heroes: Responder | None = None, job: Responder | None = None) -> Responder:
    def answer(r: httpx.Request) -> httpx.Response:
        path = r.url.path
        if path.endswith("/patches"):
            return hp_response("v1_patches_200.json")
        if path.endswith("/players/heroes"):
            return (heroes or (lambda _r: hp_response("v1_players_heroes_season_202.json")))(r)
        if "/jobs/" in path:
            return (job or (lambda _r: hp_response("v1_jobs_players_heroes_200.json")))(r)
        raise AssertionError(f"unexpected call {path}")

    return answer


def calls(fake: FakeHP, part: str) -> list[httpx.Request]:
    return [r for r in fake.requests if part in r.url.path]


def warm(_r: httpx.Request) -> httpx.Response:
    """A query HP already has answers 200 straight away, the same rows."""
    return httpx.Response(
        200,
        json=hp_response("v1_jobs_players_heroes_200.json").json(),
        headers={"x-hp-quota-limit": "500", "x-hp-quota-remaining": "480", "x-hp-quota-reset": "9"},
    )


def quota_429(_r: httpx.Request) -> httpx.Response:
    return httpx.Response(
        429,
        json={"error": {"code": "quota_exceeded", "message": "week"}},
        headers={"x-hp-quota-limit": "500", "x-hp-quota-remaining": "0", "retry-after": "500000"},
    )


async def test_the_current_seasons_storm_league_heroes(svc: SeasonService, fake_hp: FakeHP) -> None:
    fake_hp.responder = route()
    r = await svc.lookup(TAG, REGION)
    assert r.outcome == "ok" and r.season == 34
    (q,) = calls(fake_hp, "/players/heroes")
    assert dict(q.url.params) == {
        "battletag": TAG,
        "region": REGION,
        "season": "34",
        "game_type": "sl",
    }
    # the job is followed, not the query asked again
    (job,) = calls(fake_hp, "/jobs/")
    assert job.url.path.endswith("/jobs/b0dbdf0c-e296-496b-a780-aa4a082f439e")
    assert len(r.heroes) == 22 and sum(h["games"] for h in r.heroes) == 66
    assert sum(h["wins"] for h in r.heroes) == 41
    ana = r.heroes[0]  # most played first
    assert ana == {
        "hero": "Ana",
        "short_name": "ana",
        "role": "Healer",
        "games": 12,
        "wins": 9,
        "losses": 3,
        "kills": 21,
        "deaths": 19,
        "assists": 179,
        "takedowns": 200,
        # the match card's stat line, as season sums (owner 2026-10-14)
        "hero_damage": 171806,
        "siege_damage": 228179,
        "healing": 907905,
        "damage_taken": 235644,
        "experience": 87420,
    }
    assert sum(h["takedowns"] for h in r.heroes) == 906  # season sums, not per-game averages


async def test_only_the_charged_ask_counts_against_the_budget(
    svc: SeasonService, fake_hp: FakeHP, sleeper: Sleeper
) -> None:
    pending = iter([httpx.Response(202, json={"status": "pending", "job_id": "x"})])
    fake_hp.responder = route(
        job=lambda r: next(pending, hp_response("v1_jobs_players_heroes_200.json"))
    )
    r = await svc.lookup(TAG, REGION)
    assert r.outcome == "ok" and len(calls(fake_hp, "/jobs/")) == 2 and sleeper.calls
    assert (await svc.status())[BUCKET]["live_calls_today"] == 1


async def test_a_warm_query_needs_no_job(svc: SeasonService, fake_hp: FakeHP) -> None:
    fake_hp.responder = route(heroes=warm)
    r = await svc.lookup(TAG, REGION)
    assert r.outcome == "ok" and len(r.heroes) == 22 and calls(fake_hp, "/jobs/") == []


async def test_cached_as_long_as_the_match_list(
    svc: SeasonService, fake_hp: FakeHP, clock: Clock, settings: Settings
) -> None:
    """Owner 2026-10-14: the same refresh period as 전적."""
    fake_hp.responder = route(heroes=warm)
    await svc.lookup(TAG, REGION)
    clock.now += settings.match_ttl_seconds - 1
    await svc.lookup(TAG, REGION)
    assert len(calls(fake_hp, "/players/heroes")) == 1
    clock.now += 2
    await svc.lookup(TAG, REGION)
    assert len(calls(fake_hp, "/players/heroes")) == 2


async def test_the_season_list_is_asked_once_a_day(
    svc: SeasonService, fake_hp: FakeHP, clock: Clock, settings: Settings
) -> None:
    fake_hp.responder = route(heroes=warm)
    await svc.lookup(TAG, REGION)
    await svc.lookup("Other#1234", REGION)
    assert len(calls(fake_hp, "/patches")) == 1
    clock.now += settings.season_list_ttl_seconds + 1
    await svc.lookup("Third#1234", REGION)
    assert len(calls(fake_hp, "/patches")) == 2


async def test_a_new_season_does_not_serve_last_seasons_answer(
    svc: SeasonService, fake_hp: FakeHP, store: HPStore, clock: Clock
) -> None:
    old = {"season": 33, "heroes": [{"hero": "Ana", "games": 99}]}
    await store.put(CacheEntry(season_key(REGION, TAG), 200, old, clock.now, clock.now + 3600))
    fake_hp.responder = route(heroes=warm)
    r = await svc.lookup(TAG, REGION)
    assert r.season == 34 and r.heroes[0]["games"] == 12


async def test_an_answer_cached_before_the_stat_line_is_asked_again(
    svc: SeasonService, fake_hp: FakeHP, store: HPStore, clock: Clock
) -> None:
    """Rows from before 2026-10-14 lack the damage and healing sums: not served as fresh."""
    old = {"season": 34, "heroes": [{"hero": "Ana", "games": 12, "kills": 21}]}
    await store.put(CacheEntry(season_key(REGION, TAG), 200, old, clock.now, clock.now + 3600))
    fake_hp.responder = route(heroes=warm)
    r = await svc.lookup(TAG, REGION)
    assert len(calls(fake_hp, "/players/heroes")) == 1
    assert r.heroes[0]["hero_damage"] == 171806


async def test_an_old_format_answer_still_serves_as_stale(
    svc: SeasonService, fake_hp: FakeHP, store: HPStore, clock: Clock
) -> None:
    old = {"season": 34, "heroes": [{"hero": "Ana", "games": 12}]}
    await store.put(CacheEntry(season_key(REGION, TAG), 200, old, clock.now, clock.now + 3600))
    fake_hp.responder = route(heroes=quota_429)
    r = await svc.lookup(TAG, REGION)
    assert (r.outcome, r.stale, r.heroes[0]["games"]) == ("ok", True, 12)


async def test_no_storm_league_this_season_is_an_empty_list(
    svc: SeasonService, fake_hp: FakeHP
) -> None:
    fake_hp.responder = route(heroes=lambda _r: httpx.Response(200, json=[]))
    r = await svc.lookup(TAG, REGION)
    assert (r.outcome, r.heroes) == ("ok", [])
    # live HP says `player_not_found` for a player it knows with no games in the filter
    # (2026-10-15, two in the log); the profile already found them, so it is an empty season
    for code in ("not_found", "player_not_found"):
        fake_hp.responder = route(
            heroes=lambda _r, c=code: httpx.Response(
                404, json={"error": {"code": c, "message": "x"}}
            )
        )
        r = await svc.lookup(f"Other{len(code)}#1234", REGION)
        assert (r.outcome, r.heroes) == ("ok", [])
    # kept like any answer: the next search costs no call
    n = len(calls(fake_hp, "/players/heroes"))
    assert (await svc.lookup("Other16#1234", REGION)).heroes == []
    assert len(calls(fake_hp, "/players/heroes")) == n


async def test_private_players_cost_no_call_and_are_dropped(
    svc: SeasonService, fake_hp: FakeHP, store: HPStore
) -> None:
    fake_hp.responder = route(
        heroes=lambda _r: httpx.Response(
            403, json={"error": {"code": "player_unavailable", "message": "x"}}
        )
    )
    assert (await svc.lookup(TAG, REGION)).outcome == "private"
    assert await store.is_private(REGION, TAG)
    n = len(fake_hp.requests)
    assert (await svc.lookup(TAG, REGION)).outcome == "private"
    assert len(fake_hp.requests) == n
    await store.put(CacheEntry(season_key(REGION, "Third#1234"), 200, {"heroes": []}, 1, 2))
    await store.mark_private(REGION, "third#1234", "2026-10-14T00:00:00Z")
    assert await store.get(season_key(REGION, "Third#1234")) is None


async def test_over_the_budget_a_recent_answer_is_served_stale_else_quota(
    svc: SeasonService, fake_hp: FakeHP, clock: Clock, settings: Settings
) -> None:
    fake_hp.responder = route(heroes=warm)
    await svc.lookup(TAG, REGION)
    clock.now += settings.match_ttl_seconds + 1
    fake_hp.responder = route(heroes=quota_429)
    r = await svc.lookup(TAG, REGION)
    assert (r.outcome, r.stale, r.notice) == ("ok", True, "quota_exceeded")
    assert (await svc.lookup("Fresh#1111", REGION)).outcome == "quota_exceeded"
    # the bucket is marked empty: no further asks until it resets
    n = len(calls(fake_hp, "/players/heroes"))
    await svc.lookup("Fresh#2222", REGION)
    assert len(calls(fake_hp, "/players/heroes")) == n


async def test_the_daily_budget_holds_the_bucket(
    svc: SeasonService, fake_hp: FakeHP, settings: Settings
) -> None:
    settings.season_daily_budget = 0
    fake_hp.responder = route(heroes=warm)
    assert (await svc.lookup(TAG, REGION)).outcome == "quota_exceeded"
    assert calls(fake_hp, "/players/heroes") == []


async def test_a_job_that_never_finishes_is_unavailable(
    svc: SeasonService, fake_hp: FakeHP, sleeper: Sleeper, settings: Settings
) -> None:
    fake_hp.responder = route(
        job=lambda _r: httpx.Response(202, json={"status": "pending", "job_id": "x"})
    )
    assert (await svc.lookup(TAG, REGION)).outcome == "unavailable"
    assert sum(sleeper.calls) <= settings.hp_job_wait_seconds


async def test_without_a_season_list_there_is_nothing_to_ask(
    svc: SeasonService, fake_hp: FakeHP
) -> None:
    fake_hp.responder = lambda _r: httpx.Response(500, json={"error": {"code": "server_error"}})
    assert (await svc.lookup(TAG, REGION)).outcome == "unavailable"
    assert calls(fake_hp, "/players/heroes") == []


@pytest.fixture
def client(settings: Settings, fake_hp: FakeHP, clock: Clock) -> Iterator[TestClient]:
    app = create_app(settings, hp_transport=fake_hp.transport, clock=clock, privacy_poll=False)
    with TestClient(app) as c:
        yield c


def test_route(client: TestClient, fake_hp: FakeHP) -> None:
    fake_hp.responder = route(heroes=warm)
    r = client.get("/v1/players/season", params={"battletag": TAG, "region": REGION})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"season", "mode", "heroes", "fetched_at", "stale", "notice"}
    assert (body["season"], body["mode"], body["heroes"][0]["hero"]) == (34, "sl", "Ana")
    assert client.get("/healthz").json()["quota"][BUCKET]["live_calls_today"] == 1
    bad = client.get("/v1/players/season", params={"battletag": "nope", "region": REGION})
    assert bad.status_code == 422

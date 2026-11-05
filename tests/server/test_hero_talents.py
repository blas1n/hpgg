"""A hero's talent tree on one map (영웅 상세, owner 2026-11-05).

HP `/heroes/talents/details?hero=&game_map=&league_tier=` answers every talent of every level
with its games, wins, popularity and win rate (bucket `heroes_talents_details`, 210/week on
Intermediate, which the weekly report also spends). Asked when a visitor picks a map, kept a week.
A cold query answers 202 with a job id like every v1 endpoint; a warm one 200 straight away
(recorded 2026-11-05: Hanzo on Battlefield of Eternity, 1,776 games, quota 210 → 204).
The patch's builds come from `/patches`: the page names the patch, the server picks its builds.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from server.config import Settings
from server.db import Database, migrate
from server.heroes.talents import BUCKET, TalentService, builds_of
from server.players.hp import HPClient
from server.players.store import HPStore
from tests.server.conftest import BASE, TOKEN, Clock, FakeHP, hp_response, recorded

HERO, MAP, PATCH = "Hanzo", "Battlefield of Eternity", "2.57.0"
BUILDS = "2.57.0.98285,2.57.0.98304,2.57.0.98348"
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

    async def __call__(self, seconds: float) -> None:
        self.clock.now += seconds


@pytest.fixture
def store(db: Database) -> HPStore:
    return HPStore(db)


@pytest.fixture
def svc(settings: Settings, store: HPStore, fake_hp: FakeHP, clock: Clock) -> TalentService:
    hp = HPClient(
        base_url=BASE, token=TOKEN, http=httpx.AsyncClient(transport=fake_hp.transport), clock=clock
    )
    return TalentService(hp=hp, store=store, settings=settings, clock=clock, sleep=Sleeper(clock))


def warm(_r: httpx.Request) -> httpx.Response:
    return hp_response("v1_heroes_talents_details_200.json")


def cold(_r: httpx.Request) -> httpx.Response:
    return hp_response("v1_heroes_talents_details_202.json")


def job_done(_r: httpx.Request) -> httpx.Response:
    """`/jobs/{id}` answers the rows without an X-HP-Quota reading."""
    return httpx.Response(200, json=recorded("v1_heroes_talents_details_200.json")["body"])


def route(details: Responder = warm, job: Responder = job_done) -> Responder:
    def answer(r: httpx.Request) -> httpx.Response:
        path = r.url.path
        if path.endswith("/patches"):
            return hp_response("v1_patches_200.json")
        if path.endswith("/heroes/talents/details"):
            return details(r)
        if "/jobs/" in path:
            return job(r)
        raise AssertionError(f"unexpected call {path}")

    return answer


def calls(fake: FakeHP, part: str) -> list[httpx.Request]:
    return [r for r in fake.requests if part in r.url.path]


def test_builds_of_a_patch_are_its_valid_builds_oldest_first() -> None:
    patches = recorded("v1_patches_200.json")["body"]
    assert builds_of(patches, "2.57.0") == BUILDS
    assert builds_of(patches, "2.55.17") is not None
    assert builds_of(patches, "2.99.0") is None


async def test_a_map_tree_per_level_most_played_first(svc: TalentService, fake_hp: FakeHP) -> None:
    fake_hp.responder = route()
    r = await svc.lookup(HERO, MAP, "all", PATCH)
    assert r.outcome == "ok" and r.builds == BUILDS and not r.stale
    (q,) = calls(fake_hp, "/heroes/talents/details")
    assert dict(q.url.params) == {
        "timeframe_type": "minor",
        "timeframe": BUILDS,
        "game_type": "sl",
        "hero": HERO,
        "game_map": MAP,
    }
    assert list(r.levels) == ["1", "4", "7", "10", "13", "16", "20"]
    four = r.levels["4"]
    assert four[0]["talent"] == "HanzoSerratedArrows"
    assert [t["games"] for t in four] == sorted((t["games"] for t in four), reverse=True)
    assert set(four[0]) == {"talent", "games", "wins", "popularity", "win_rate"}
    assert sum(t["games"] for t in r.levels["1"]) == 1776


@pytest.mark.parametrize(("tier", "league"), [("high", "5,6"), ("low", "1,2,3,4")])
async def test_a_bracket_is_hps_league_tiers(
    svc: TalentService, fake_hp: FakeHP, tier: str, league: str
) -> None:
    """The same brackets as the builds (data/latest/builds.json): 다마그 5-6, 브실골플 1-4."""
    fake_hp.responder = route()
    assert (await svc.lookup(HERO, MAP, tier, PATCH)).outcome == "ok"
    (q,) = calls(fake_hp, "/heroes/talents/details")
    assert q.url.params["league_tier"] == league


async def test_a_cold_query_waits_for_its_job_and_is_charged_once(
    svc: TalentService, fake_hp: FakeHP, store: HPStore
) -> None:
    fake_hp.responder = route(details=cold)
    r = await svc.lookup(HERO, MAP, "all", PATCH)
    assert r.outcome == "ok" and r.levels["4"][0]["talent"] == "HanzoSerratedArrows"
    assert len(calls(fake_hp, "/jobs/")) == 1
    assert (await svc.status())[BUCKET]["live_calls_today"] == 1


async def test_kept_a_week_then_asked_again(
    svc: TalentService, fake_hp: FakeHP, clock: Clock, settings: Settings
) -> None:
    fake_hp.responder = route()
    await svc.lookup(HERO, MAP, "all", PATCH)
    await svc.lookup(HERO, MAP, "all", PATCH)
    assert len(calls(fake_hp, "/heroes/talents/details")) == 1
    # each map and bracket is its own entry
    await svc.lookup(HERO, MAP, "high", PATCH)
    await svc.lookup(HERO, "Dragon Shire", "all", PATCH)
    assert len(calls(fake_hp, "/heroes/talents/details")) == 3
    clock.now += settings.talents_ttl_seconds + 1
    await svc.lookup(HERO, MAP, "all", PATCH)
    assert len(calls(fake_hp, "/heroes/talents/details")) == 4


async def test_visitors_asking_together_share_one_call(svc: TalentService, fake_hp: FakeHP) -> None:
    fake_hp.responder = route(details=cold)
    a, b = await asyncio.gather(
        svc.lookup(HERO, MAP, "all", PATCH), svc.lookup(HERO, MAP, "all", PATCH)
    )
    assert a.outcome == b.outcome == "ok"
    assert len(calls(fake_hp, "/heroes/talents/details")) == 1


async def test_past_the_days_budget_no_call_and_an_old_answer_is_served_stale(
    svc: TalentService, fake_hp: FakeHP, clock: Clock, settings: Settings
) -> None:
    fake_hp.responder = route()
    await svc.lookup(HERO, MAP, "all", PATCH)
    clock.now += settings.talents_ttl_seconds + 1  # a week on: the answer is old, the day new
    for i in range(settings.talents_daily_budget):
        assert (await svc.lookup(f"Hero{i}", MAP, "all", PATCH)).outcome == "ok"
    asked = len(calls(fake_hp, "/heroes/talents/details"))
    old = await svc.lookup(HERO, MAP, "all", PATCH)
    assert old.outcome == "ok" and old.stale and old.notice == "quota_exceeded"
    none = await svc.lookup("Zeratul", MAP, "all", PATCH)
    assert none.outcome == "quota_exceeded" and none.retry_after
    assert len(calls(fake_hp, "/heroes/talents/details")) == asked


async def test_hps_weekly_reading_stops_live_calls_at_the_floor(
    svc: TalentService, fake_hp: FakeHP, settings: Settings
) -> None:
    low = str(settings.talents_quota_floor)
    fake_hp.responder = route(
        details=lambda _r: hp_response(
            "v1_heroes_talents_details_200.json", **{"x-hp-quota-remaining": low}
        )
    )
    assert (await svc.lookup(HERO, MAP, "all", PATCH)).outcome == "ok"
    assert (await svc.lookup("Valla", MAP, "all", PATCH)).outcome == "quota_exceeded"
    assert len(calls(fake_hp, "/heroes/talents/details")) == 1


async def test_a_patch_hp_does_not_list_is_refused_without_asking_for_talents(
    svc: TalentService, fake_hp: FakeHP
) -> None:
    fake_hp.responder = route()
    assert (await svc.lookup(HERO, MAP, "all", "2.99.0")).outcome == "unknown_patch"
    assert calls(fake_hp, "/heroes/talents/details") == []


async def test_a_hero_hp_does_not_know_is_not_found_and_not_kept(
    svc: TalentService, fake_hp: FakeHP
) -> None:
    def unknown(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"error": {"code": "validation_failed", "message": "hero"}})

    fake_hp.responder = route(details=unknown)
    assert (await svc.lookup("Nobody", MAP, "all", PATCH)).outcome == "not_found"
    assert (await svc.lookup("Nobody", MAP, "all", PATCH)).outcome == "not_found"
    assert len(calls(fake_hp, "/heroes/talents/details")) == 2


async def test_hp_down_without_a_kept_answer_is_unavailable(
    svc: TalentService, fake_hp: FakeHP
) -> None:
    fake_hp.responder = route(details=lambda _r: httpx.Response(500, json={}))
    assert (await svc.lookup(HERO, MAP, "all", PATCH)).outcome == "unavailable"


# ---------------------------------------------------------------- the route


def test_route_answers_the_tree(make_client: Callable[..., TestClient], fake_hp: FakeHP) -> None:
    fake_hp.responder = route()
    with make_client() as c:
        r = c.get(
            "/v1/heroes/talents", params={"hero": HERO, "map": MAP, "tier": "all", "patch": PATCH}
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["hero"] == HERO and body["map"] == MAP and body["tier"] == "all"
    assert body["patch"] == PATCH and body["builds"] == BUILDS and body["stale"] is False
    assert body["levels"]["4"][0]["talent"] == "HanzoSerratedArrows"
    assert body["fetched_at"].endswith("Z")
    assert "public" in r.headers["cache-control"]


@pytest.mark.parametrize(
    "params",
    [
        {"hero": HERO, "map": "Nowhere", "tier": "all", "patch": PATCH},  # not a Storm League map
        {"hero": HERO, "map": MAP, "tier": "mid", "patch": PATCH},
        {"hero": HERO, "map": MAP, "tier": "all", "patch": "2.57.0.98348"},  # a patch, not a build
        {"hero": "<script>", "map": MAP, "tier": "all", "patch": PATCH},
        {"hero": HERO, "map": MAP, "tier": "all", "patch": PATCH, "region": "KR"},
    ],
)
def test_route_refuses_what_it_cannot_ask(
    make_client: Callable[..., TestClient], fake_hp: FakeHP, params: dict[str, str]
) -> None:
    fake_hp.responder = route()
    with make_client() as c:
        assert c.get("/v1/heroes/talents", params=params).status_code == 422
    assert calls(fake_hp, "/heroes/talents/details") == []


def test_route_says_a_spent_budget_with_429(
    make_client: Callable[..., TestClient], fake_hp: FakeHP
) -> None:
    fake_hp.responder = route(
        details=lambda _r: httpx.Response(
            429,
            json={"error": {"code": "quota_exceeded", "message": "week"}},
            headers={"x-hp-quota-limit": "210", "x-hp-quota-remaining": "0", "retry-after": "5000"},
        )
    )
    with make_client() as c:
        r = c.get(
            "/v1/heroes/talents", params={"hero": HERO, "map": MAP, "tier": "all", "patch": PATCH}
        )
    assert r.status_code == 429 and r.json()["error"]["code"] == "quota_exceeded"


def test_the_routes_maps_are_the_sites_maps() -> None:
    """The map filter offers data/maps_ko.json; a map the route refuses would never load."""
    import json
    from pathlib import Path
    from typing import get_args

    from server.heroes.router import MapName

    site = json.loads((Path(__file__).parents[2] / "data" / "maps_ko.json").read_text())
    assert set(get_args(MapName)) == {m["name"] for m in site["maps"]}

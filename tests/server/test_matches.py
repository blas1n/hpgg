"""A player's match list: full stat lines when the small bucket allows, else the MMR history.

HP `/players/matches` (bucket player_match_history, 250/week on Basic) answers up to 100 games with
the full stat line, talents and per-game MMR; a cold query answers 202 and is polled, and HP
charges every ask (2026-10-08: one job that never finished took 11 off the week, polls included).
`/players/mmr/history` (player_mmr_history, 10,000/week) answers one game type's games
with hero, map id, result and MMR only. Shapes recorded 2026-10-01.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable

import httpx
import pytest

from server.config import Settings
from server.db import Database, migrate
from server.players.hp import HPClient
from server.players.matches import MatchService
from server.players.service import PlayerService
from server.players.store import CacheEntry, HPStore, matches_key, player_key
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
    """Stands in for asyncio.sleep: advances the clock instead of waiting."""

    def __init__(self, clock: Clock) -> None:
        self.clock = clock
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)
        self.clock.now += seconds


@pytest.fixture
def sleeper(clock: Clock) -> Sleeper:
    return Sleeper(clock)


@pytest.fixture
def svc(
    settings: Settings, db: Database, fake_hp: FakeHP, clock: Clock, sleeper: Sleeper
) -> MatchService:
    hp = HPClient(
        base_url=BASE, token=TOKEN, http=httpx.AsyncClient(transport=fake_hp.transport), clock=clock
    )
    store = HPStore(db)
    players = PlayerService(hp=hp, store=store, settings=settings, clock=clock)
    return MatchService(
        hp=hp, store=store, players=players, settings=settings, clock=clock, sleep=sleeper
    )


def route(
    *,
    matches: Responder | None = None,
    history: Responder | None = None,
    players: Responder | None = None,
) -> Responder:
    def answer(r: httpx.Request) -> httpx.Response:
        path = r.url.path
        if path.endswith("/players/matches"):
            return (matches or (lambda _r: hp_response("v1_players_matches_200.json")))(r)
        if path.endswith("/players/mmr/history"):
            return (history or (lambda _r: hp_response("v1_players_mmr_history_200.json")))(r)
        if path.endswith("/players"):
            return (players or (lambda _r: hp_response("v1_players_200.json")))(r)
        raise AssertionError(f"unexpected call {path}")

    return answer


def calls(fake: FakeHP, suffix: str) -> list[httpx.Request]:
    return [r for r in fake.requests if r.url.path.endswith(suffix)]


def quota_429() -> httpx.Response:
    return httpx.Response(
        429,
        json={"error": {"code": "quota_exceeded", "message": "allowance used"}},
        headers={"Retry-After": "7200"},
    )


async def test_full_stat_lines_live_then_cached(svc: MatchService, fake_hp: FakeHP) -> None:
    fake_hp.responder = route()
    r = await svc.lookup(TAG, REGION)
    assert r.outcome == "ok" and r.source == "full" and not r.stale
    assert len(r.matches) == 3
    m = r.matches[0]
    assert m["replay_id"] == 65597227 and m["date"] == "2026-09-30 15:06:00"
    assert (m["mode"], m["map"], m["hero"], m["short_name"]) == (
        "qm",
        "Hanamura Temple",
        "Alarak",
        "alarak",
    )
    assert m["win"] is True and m["role"] == "Melee Assassin"
    assert (m["kills"], m["deaths"], m["assists"]) == (9, 1, 25)
    assert m["hero_damage"] == 72367 and m["siege_damage"] == 33278
    assert m["healing"] is None and m["self_healing"] == 24304
    assert m["experience"] == 11422 and m["level"] == 22
    assert m["mmr"] == 2342 and m["mmr_change"] == pytest.approx(43.05, abs=0.01)
    assert len(m["talents"]) == 7 and m["talents"][0] == "AlarakOverwhelmingPowerDiscordStrike"
    q = calls(fake_hp, "/players/matches")[0]
    assert q.url.params["battletag"] == TAG and q.url.params["region"] == REGION
    again = await svc.lookup(TAG, REGION)
    assert again.source == "full" and len(calls(fake_hp, "/players/matches")) == 1


async def test_a_cold_query_is_polled_until_ready_and_every_ask_is_counted(
    svc: MatchService, fake_hp: FakeHP, db: Database, sleeper: Sleeper
) -> None:
    answers = iter(["v1_players_matches_202.json", "v1_players_matches_202.json"])
    fake_hp.responder = route(
        matches=lambda r: hp_response(next(answers, "v1_players_matches_200.json"))
    )
    r = await svc.lookup(TAG, REGION)
    assert r.outcome == "ok" and r.source == "full"
    assert len(calls(fake_hp, "/players/matches")) == 3 and len(sleeper.calls) == 2
    status = await svc.status()
    assert status["player_match_history"]["live_calls_today"] == 3


async def test_a_job_that_never_finishes_falls_back_to_the_mmr_history(
    svc: MatchService, fake_hp: FakeHP, settings: Settings, sleeper: Sleeper
) -> None:
    fake_hp.responder = route(matches=lambda r: hp_response("v1_players_matches_202.json"))
    r = await svc.lookup(TAG, REGION)
    assert r.outcome == "ok" and r.source == "basic"
    assert sum(sleeper.calls) <= settings.hp_job_wait_seconds
    asked = len(calls(fake_hp, "/players/matches"))
    status = await svc.status()
    assert status["player_match_history"]["live_calls_today"] == asked


async def test_basic_rows_come_from_the_mmr_history_of_the_most_played_mode(
    settings: Settings, svc: MatchService, fake_hp: FakeHP
) -> None:
    settings.match_daily_budget = 0
    fake_hp.responder = route()
    r = await svc.lookup(TAG, REGION)
    assert r.outcome == "ok" and r.source == "basic"
    assert calls(fake_hp, "/players/matches") == []
    # the recorded profile (Zemill#1940) plays Quick Match most (3,659 games)
    assert calls(fake_hp, "/players/mmr/history")[0].url.params["game_type"] == "qm"
    m = r.matches[0]
    assert (m["replay_id"], m["hero"], m["map"], m["win"]) == (
        65597227,
        "Alarak",
        "Hanamura Temple",  # from the map id through HP's /maps table
        True,
    )
    assert m["mode"] == "qm" and m["mmr"] == 2342 and m["mmr_change"] == 43.05
    assert m["kills"] is None and m["talents"] == []
    assert r.matches[1]["win"] is True


async def test_hp_quota_exceeded_on_full_falls_back_and_stops_asking(
    svc: MatchService, fake_hp: FakeHP, clock: Clock, settings: Settings
) -> None:
    fake_hp.responder = route(matches=lambda r: quota_429())
    assert (await svc.lookup(TAG, REGION)).source == "basic"
    clock.now += settings.basic_match_ttl_seconds + 1
    assert (await svc.lookup(TAG, REGION)).source == "basic"
    assert len(calls(fake_hp, "/players/matches")) == 1


async def test_a_stale_full_list_beats_a_fresh_basic_one(
    svc: MatchService, fake_hp: FakeHP, clock: Clock, settings: Settings
) -> None:
    fake_hp.responder = route()
    await svc.lookup(TAG, REGION)
    clock.now += settings.match_ttl_seconds + 1
    fake_hp.responder = route(matches=lambda r: quota_429())
    r = await svc.lookup(TAG, REGION)
    assert r.source == "full" and r.stale and r.notice == "quota_exceeded"
    assert calls(fake_hp, "/players/mmr/history") == []


async def test_a_stale_full_list_is_not_served_past_the_stale_limit(
    svc: MatchService, fake_hp: FakeHP, clock: Clock, settings: Settings
) -> None:
    fake_hp.responder = route()
    await svc.lookup(TAG, REGION)
    clock.now += settings.stale_max_seconds + 1
    fake_hp.responder = route(matches=lambda r: quota_429())
    assert (await svc.lookup(TAG, REGION)).source == "basic"


async def test_both_sources_out_serves_unavailable_or_quota(
    settings: Settings, svc: MatchService, fake_hp: FakeHP
) -> None:
    fake_hp.responder = route(
        matches=lambda r: quota_429(),
        history=lambda r: httpx.Response(500, json={"error": {"code": "server_error"}}),
    )
    assert (await svc.lookup(TAG, REGION)).outcome == "unavailable"
    settings.mmr_history_daily_budget = 0
    assert (await svc.lookup("Other#1234", REGION)).outcome == "quota_exceeded"


async def test_a_player_hp_does_not_know_is_not_found(svc: MatchService, fake_hp: FakeHP) -> None:
    fake_hp.responder = route(matches=lambda r: hp_response("v1_players_404.json"))
    assert (await svc.lookup("Nobody#1234", REGION)).outcome == "not_found"


async def test_a_private_player_drops_both_cached_answers(
    svc: MatchService, fake_hp: FakeHP, db: Database, clock: Clock, settings: Settings
) -> None:
    store = HPStore(db)
    fake_hp.responder = route()
    await svc.lookup(TAG, REGION)
    await store.put(CacheEntry(player_key(REGION, TAG), 200, {}, clock.now, clock.now + 60))
    clock.now += settings.match_ttl_seconds + 1
    fake_hp.responder = route(matches=lambda r: hp_response("v1_players_403_private.json"))
    r = await svc.lookup(TAG, REGION)
    assert r.outcome == "private" and r.matches == []
    assert await store.get(matches_key(REGION, TAG)) is None
    assert await store.get(player_key(REGION, TAG)) is None
    asked = len(fake_hp.requests)
    assert (await svc.lookup(TAG.upper(), REGION)).outcome == "private"
    assert len(fake_hp.requests) == asked


async def test_the_privacy_feed_also_drops_the_match_list(
    svc: MatchService, fake_hp: FakeHP, db: Database
) -> None:
    fake_hp.responder = route()
    await svc.lookup(TAG, REGION)
    await HPStore(db).mark_private(REGION, TAG.lower(), "2026-10-01T00:00:00+00:00")
    assert await HPStore(db).get(matches_key(REGION, TAG)) is None


def test_the_full_budget_fits_the_weekly_bucket() -> None:
    s = Settings(hp_api_token="x", _env_file=None)  # type: ignore[arg-type, call-arg]
    assert s.match_daily_budget * 7 + s.match_quota_floor <= 500
    assert s.match_ttl_seconds <= s.stale_max_seconds


async def test_a_list_cached_by_an_older_row_format_is_refreshed(
    svc: MatchService, fake_hp: FakeHP, db: Database, clock: Clock
) -> None:
    # rows normalised before a field existed (award, 2026-10-01) must not be served as fresh
    old = {"source": "full", "matches": [{"replay_id": 1, "hero": "Alarak", "win": True}]}
    key = matches_key(REGION, TAG)
    await HPStore(db).put(CacheEntry(key, 200, old, clock.now, clock.now + 3600))
    fake_hp.responder = route()
    r = await svc.lookup(TAG, REGION)
    assert len(calls(fake_hp, "/players/matches")) == 1
    assert r.matches[0]["award"] == "MVP"


async def test_a_list_cut_to_basic_by_the_quota_says_when_full_lines_return(
    svc: MatchService, fake_hp: FakeHP, clock: Clock
) -> None:
    """The page tells the player when the detailed list opens again (owner 2026-10-08)."""
    fake_hp.responder = route(matches=lambda r: quota_429())
    r = await svc.lookup(TAG, REGION)
    assert r.source == "basic" and r.full_after == pytest.approx(clock.now + 7200)
    # served again from the cache, it still says so
    again = await svc.lookup(TAG, REGION)
    assert again.source == "basic" and again.full_after == pytest.approx(clock.now + 7200)


async def test_a_list_cut_to_basic_by_a_slow_job_has_no_return_time(
    svc: MatchService, fake_hp: FakeHP
) -> None:
    fake_hp.responder = route(matches=lambda r: hp_response("v1_players_matches_202.json"))
    r = await svc.lookup(TAG, REGION)
    assert r.source == "basic" and r.full_after is None


async def test_a_full_list_has_no_return_time(svc: MatchService, fake_hp: FakeHP) -> None:
    fake_hp.responder = route()
    r = await svc.lookup(TAG, REGION)
    assert r.source == "full" and r.full_after is None


def test_route_sends_the_return_time(settings: Settings, fake_hp: FakeHP, clock: Clock) -> None:
    from fastapi.testclient import TestClient

    from server.app import create_app

    settings.match_daily_budget = 0
    fake_hp.responder = route()
    app = create_app(settings, hp_transport=fake_hp.transport, clock=clock, privacy_poll=False)
    with TestClient(app) as c:
        body = c.get("/v1/players/matches", params={"battletag": TAG, "region": REGION}).json()
    assert body["source"] == "basic"
    assert body["full_after"] is not None and body["full_after"].endswith("Z")

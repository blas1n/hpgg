"""One game in full: both teams, every player's stat line, talents, award and MMR change.

HP `/replay/{id}` (bucket replay_data, 1,000/week on Basic; 500 a minute). Shape recorded
2026-10-01 (tests/server/fixtures/v1_replay_200.json). HP already leaves private players out; we
also drop any player our privacy table holds, since the answer is cached.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest

from server.config import Settings
from server.db import Database, migrate
from server.players.hp import HPClient
from server.players.match_rows import full_rows
from server.players.replays import ReplayService
from server.players.store import HPStore
from tests.server.conftest import BASE, TOKEN, Clock, FakeHP, hp_response, recorded

RID = 78191829


@pytest.fixture
async def db(settings: Settings) -> AsyncIterator[Database]:
    migrate(settings.db_path)
    database = Database(settings.db_path)
    yield database
    await database.dispose()


@pytest.fixture
def svc(settings: Settings, db: Database, fake_hp: FakeHP, clock: Clock) -> ReplayService:
    fake_hp.responder = lambda r: hp_response("v1_replay_200.json")
    hp = HPClient(
        base_url=BASE, token=TOKEN, http=httpx.AsyncClient(transport=fake_hp.transport), clock=clock
    )
    return ReplayService(hp=hp, store=HPStore(db), settings=settings, clock=clock)


async def test_a_game_in_full(svc: ReplayService, fake_hp: FakeHP) -> None:
    r = await svc.lookup(RID)
    assert r.outcome == "ok" and r.replay is not None
    g = r.replay
    assert fake_hp.requests[0].url.path.endswith(f"/replay/{RID}")
    assert (g["replay_id"], g["mode"], g["map"], g["length_s"], g["region"]) == (
        RID,
        "qm",
        "Hanamura Temple",
        3020,
        "KR",
    )
    assert [t["win"] for t in g["teams"]] == [True, False]
    assert [len(t["players"]) for t in g["teams"]] == [5, 5]
    me = next(p for p in g["teams"][0]["players"] if p["battletag"] == "Player11#1011")
    assert me["hero"] == "Alarak" and me["award"] == "MVP"
    assert (me["kills"], me["deaths"], me["assists"]) == (3, 1, 86)
    assert me["hero_damage"] == 48098 and me["experience"] == 57491
    assert me["mmr_change"] == pytest.approx(92.45, abs=0.01)
    assert len(me["talents"]) == 7 and me["talents"][0] == "AlarakOverwhelmingPowerDiscordStrike"
    bulwark = next(p for p in g["teams"][1]["players"] if p["hero"] == "Thrall")
    assert bulwark["award"] == "MostDamageTaken"  # HP id 6, sent with the Avenger icon
    party = [p["party"] for p in g["teams"][1]["players"] if p["party"]]
    assert party == ["red", "red"]


async def test_cached_and_not_asked_again(svc: ReplayService, fake_hp: FakeHP) -> None:
    await svc.lookup(RID)
    again = await svc.lookup(RID)
    assert again.outcome == "ok" and len(fake_hp.requests) == 1


async def test_a_cached_game_is_dropped_after_the_stale_limit(
    svc: ReplayService, fake_hp: FakeHP, clock: Clock, settings: Settings
) -> None:
    await svc.lookup(RID)
    clock.now += settings.stale_max_seconds + 1
    await svc.lookup(RID)
    assert len(fake_hp.requests) == 2


async def test_a_player_who_went_private_is_left_out_of_a_cached_game(
    svc: ReplayService, db: Database
) -> None:
    await svc.lookup(RID)
    await HPStore(db).mark_private("KR", "Player18#1018", "2026-10-01T00:00:00+00:00")
    g = (await svc.lookup(RID)).replay
    assert g is not None
    tags = [p["battletag"] for t in g["teams"] for p in t["players"]]
    assert "Player18#1018" not in tags and len(tags) == 9


async def test_unknown_game_is_not_found(svc: ReplayService, fake_hp: FakeHP) -> None:
    fake_hp.responder = lambda r: httpx.Response(
        404, json={"error": {"code": "not_found", "message": "x"}}
    )
    assert (await svc.lookup(1)).outcome == "not_found"


async def test_the_daily_budget_stops_live_calls(
    settings: Settings, svc: ReplayService, fake_hp: FakeHP
) -> None:
    settings.replay_daily_budget = 1
    await svc.lookup(RID)
    assert (await svc.lookup(RID + 1)).outcome == "quota_exceeded"
    assert len(fake_hp.requests) == 1


async def test_upstream_trouble_is_unavailable(svc: ReplayService, fake_hp: FakeHP) -> None:
    fake_hp.responder = lambda r: httpx.Response(500, json={"error": {"code": "server_error"}})
    assert (await svc.lookup(RID)).outcome == "unavailable"


def test_match_rows_keep_hps_award_id_to_be_named_when_served() -> None:
    rows = full_rows(recorded("v1_players_matches_200.json")["body"])
    assert rows[0]["award_id"] == "1"  # MVP, named by server/players/awards.py when served
    assert rows[1]["award_id"] is None


def test_the_replay_budget_fits_the_weekly_bucket() -> None:
    s = Settings(hp_api_token="x", _env_file=None)  # type: ignore[arg-type, call-arg]
    assert s.replay_daily_budget * 7 + s.replay_quota_floor <= 25_000


async def test_a_game_cached_by_an_older_format_is_refreshed(
    svc: ReplayService, fake_hp: FakeHP, db: Database, clock: Clock
) -> None:
    from server.players.replays import replay_key
    from server.players.store import CacheEntry

    old = {"replay_id": RID, "teams": []}
    await HPStore(db).put(CacheEntry(replay_key(RID), 200, old, clock.now, clock.now + 3600))
    r = await svc.lookup(RID)
    assert len(fake_hp.requests) == 1 and r.replay is not None and len(r.replay["teams"]) == 2

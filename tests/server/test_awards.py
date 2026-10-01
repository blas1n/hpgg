"""End-of-match awards: HP's award ids → the game's award keys, learned by the server itself.

HP names an award by its own id; a /replay/{id} answer also gives the award's title and icon, so an
id the shipped table lacks is resolved there (title first, then icon) and remembered in
`hp_award_map`. Match lists keep HP's id and are named when served, so a learned id reaches lists
cached before it was learned.
"""

from __future__ import annotations

import copy
from collections.abc import AsyncIterator

import httpx
import pytest

from server.config import Settings
from server.db import Database, migrate
from server.players.awards import AwardBook, resolve_key
from server.players.hp import HPClient
from server.players.matches import MatchService
from server.players.replays import ReplayService
from server.players.service import PlayerService
from server.players.store import HPStore
from tests.server.conftest import BASE, TOKEN, Clock, FakeHP, recorded


@pytest.fixture
async def db(settings: Settings) -> AsyncIterator[Database]:
    migrate(settings.db_path)
    database = Database(settings.db_path)
    yield database
    await database.dispose()


def test_resolve_by_title_first_then_icon() -> None:
    assert resolve_key("Bulwark", "storm_ui_mvp_avenger") == "MostDamageTaken"  # HP's icon is wrong
    assert resolve_key("Most XP Contribution", "storm_ui_mvp_experienced") == "MostXPContribution"
    assert resolve_key("Stunner", None) == "MostStuns"
    assert resolve_key("Something New", "storm_ui_mvp_somethingnew") is None


async def test_shipped_ids_need_no_learning(db: Database, clock: Clock) -> None:
    book = AwardBook(HPStore(db), clock)
    assert await book.key("1") == "MVP"
    assert await book.key("9999") is None


async def test_an_unknown_id_is_learned_and_kept_across_restarts(
    db: Database, clock: Clock
) -> None:
    store = HPStore(db)
    assert (
        await AwardBook(store, clock).learn("77", "Stunner", "storm_ui_mvp_stunner") == "MostStuns"
    )
    assert await AwardBook(store, clock).key("77") == "MostStuns"
    assert (await AwardBook(store, clock).table())["77"] == "MostStuns"


async def test_an_award_the_game_data_lacks_is_not_learned(db: Database, clock: Clock) -> None:
    store = HPStore(db)
    assert await AwardBook(store, clock).learn("88", "Something New", "storm_ui_mvp_x") is None
    assert await AwardBook(store, clock).key("88") is None


def _hp(fake: FakeHP, clock: Clock) -> HPClient:
    return HPClient(
        base_url=BASE, token=TOKEN, http=httpx.AsyncClient(transport=fake.transport), clock=clock
    )


async def test_an_opened_game_teaches_the_match_list_its_award(
    settings: Settings, db: Database, fake_hp: FakeHP, clock: Clock
) -> None:
    store = HPStore(db)
    # a match list whose first game carries an id the shipped table lacks, cached first
    matches = copy.deepcopy(recorded("v1_players_matches_200.json"))
    matches["body"]["data"][0]["match_award"] = "77"
    # the same game opened: HP names the award there
    replay = copy.deepcopy(recorded("v1_replay_200.json"))
    me = next(p for t in replay["body"]["players"] for p in t if p["battletag"] == "Player11#1011")
    me["match_award"] = {"award_id": 77, "title": "Stunner", "icon": "storm_ui_mvp_stunner"}

    def answer(r: httpx.Request) -> httpx.Response:
        rec = replay if "/replay/" in r.url.path else matches
        return httpx.Response(rec["status"], json=rec["body"], headers=rec["headers"])

    fake_hp.responder = answer
    hp = _hp(fake_hp, clock)
    players = PlayerService(hp=hp, store=store, settings=settings, clock=clock)
    ms = MatchService(hp=hp, store=store, players=players, settings=settings, clock=clock)
    rs = ReplayService(hp=hp, store=store, settings=settings, clock=clock)

    before = await ms.lookup("Player11#1011", "KR")
    assert before.matches[0]["award"] is None
    game = (await rs.lookup(65597227)).replay
    assert game is not None
    mine = next(p for t in game["teams"] for p in t["players"] if p["battletag"] == "Player11#1011")
    assert mine["award"] == "MostStuns"
    after = await ms.lookup("Player11#1011", "KR")  # the cached list, not asked again
    assert after.matches[0]["award"] == "MostStuns"
    assert sum(r.url.path.endswith("/players/matches") for r in fake_hp.requests) == 1

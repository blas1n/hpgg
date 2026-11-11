"""The owner-only MCP's tools (docs/DESIGN-2026-11-11-owner-mcp.md): the owner's Storm League
games, kept in `owner_matches` and refreshed on use; one game's ten players on demand; plain
counts by hero, map, role or draft position; the hero pool; the high-tier baseline.

Raw data only: observed fields as HP gives them, derived ones end in `_derived`, missing ones are
null, and no score or verdict is made up. Other players' BattleTags never reach a tool answer or
the owner tables.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from server.config import Settings
from tests.server.accounts_support import ORIGIN
from tests.server.conftest import Clock, FakeHP, hp_response
from tests.server.mcp_support import OWNER, call_tool, connect

NEWEST = 66623506  # Malthael, Dragon Shire, loss, 1,261 s; the one game with a recorded replay


def hp_routes(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path.endswith("/players/matches"):
        assert request.url.params["game_type"] == "sl"
        return hp_response("v1_players_matches_sl_200.json")
    if path.endswith(f"/replay/{NEWEST}"):
        return hp_response("v1_replay_sl_200.json")
    if "/replay/" in path:
        return httpx.Response(404, json={"error": {"code": "not_found", "message": "x"}})
    return hp_response("v1_players_200.json")


@pytest.fixture
def owner(make_client: Callable[..., TestClient], fake_hp: FakeHP) -> tuple[TestClient, str]:
    fake_hp.responder = hp_routes
    c = make_client(mcp_owner_battletag=OWNER, mcp_replay_interval_seconds=0.0)
    return c, connect(c)["access_token"]


def list_calls(fake_hp: FakeHP) -> int:
    return sum(r.url.path.endswith("/players/matches") for r in fake_hp.requests)


def test_status_counts_what_is_stored(owner: tuple[TestClient, str]) -> None:
    c, token = owner
    s = call_tool(c, token, "get_status")
    assert s["owner"] == OWNER
    assert s["mode"] == "sl"
    assert s["storm_league"]["tier"] == "Diamond 2"
    assert s["storm_league"]["wins"] == 48
    assert s["games_stored"] == 3
    assert s["first_game"] == "2026-11-10 16:22:18"
    assert s["last_game"] == "2026-11-10 17:20:20"
    assert s["sync"]["running"] is False
    assert s["sync"]["last_result"] == "ok"
    assert s["sync"]["games_without_detail"] == 2
    assert s["limits"]  # coverage notes for whoever reads the numbers


def test_matches_newest_first_with_draft_and_party(owner: tuple[TestClient, str]) -> None:
    c, token = owner
    out = call_tool(c, token, "list_matches")
    assert out["total"] == 3
    ids = [m["match_id"] for m in out["matches"]]
    assert ids == [66623506, 66623504, 66623501]
    m = out["matches"][0]
    assert m["hero"] == "Malthael"
    assert m["hero_ko"] == "말티엘"
    assert m["map"] == "Dragon Shire"
    assert m["map_ko"] == "용의 둥지"
    assert m["win"] is False
    assert m["game_length_s"] == 1261
    assert (m["kills"], m["deaths"], m["assists"]) == (6, 3, 6)
    assert m["party_size_derived"] == 1
    assert m["my_team_first_pick_derived"] is False
    assert m["my_pick_within_team_derived"] == 4
    assert m["my_pick_overall_derived"] == 7
    assert len(m["talents"]) == 7
    # a game whose replay HP did not give: the fields it would fill are null, not guessed
    other = out["matches"][1]
    assert other["game_length_s"] is None
    assert other["party_size_derived"] is None
    assert other["kills"] == 4


def test_filters_take_english_or_korean(owner: tuple[TestClient, str]) -> None:
    c, token = owner
    assert call_tool(c, token, "list_matches", hero="레가르")["total"] == 2
    assert call_tool(c, token, "list_matches", hero="Rehgar", result="win")["total"] == 2
    assert call_tool(c, token, "list_matches", map="용의 둥지")["total"] == 1
    assert call_tool(c, token, "list_matches", role="Healer")["total"] == 2
    assert call_tool(c, token, "list_matches", since="2026-11-10 17:00:00")["total"] == 1
    page = call_tool(c, token, "list_matches", limit=1, offset=1)
    assert [m["match_id"] for m in page["matches"]] == [66623504]
    assert page["total"] == 3


def test_unknown_hero_name_is_said_not_ignored(owner: tuple[TestClient, str]) -> None:
    c, token = owner
    out = call_tool(c, token, "list_matches", hero="Nobody")
    assert out["total"] == 0
    assert out["error"] == "unknown_hero"


def test_one_game_in_full_without_battletags(owner: tuple[TestClient, str]) -> None:
    c, token = owner
    g = call_tool(c, token, "get_match", match_id=NEWEST)
    assert g["match_id"] == NEWEST
    assert g["game_length_s"] == 1261
    assert [len(t["players"]) for t in g["teams"]] == [5, 5]
    me = [p for t in g["teams"] for p in t["players"] if p["is_me"]]
    assert len(me) == 1 and me[0]["hero"] == "Malthael"
    assert me[0]["stats"]["hero_damage"] == 94038
    assert me[0]["stats"]["experience_contribution"] == 21137  # HP's names, as in list rows
    assert len(me[0]["talents"]) == 7
    ids = {p["player_id"] for t in g["teams"] for p in t["players"]}
    assert len(ids) == 10
    assert "#" not in str(g)
    picks = [e for e in g["draft"]["events"] if e["type"] == "pick"]
    assert len(picks) == 10
    assert g["teams"][0]["bans"]


def test_unknown_game(owner: tuple[TestClient, str]) -> None:
    c, token = owner
    assert call_tool(c, token, "get_match", match_id=1)["error"] == "not_found"


def test_summarize_by_hero(owner: tuple[TestClient, str]) -> None:
    c, token = owner
    out = call_tool(c, token, "summarize", group_by="hero")
    rows = {r["key"]: r for r in out["rows"]}
    assert rows["Rehgar"]["games"] == 2
    assert rows["Rehgar"]["wins"] == 2
    assert rows["Rehgar"]["win_rate"] == 100.0
    assert rows["Rehgar"]["kills"] == 6
    assert rows["Malthael"]["total_game_seconds"] == 1261
    assert rows["Malthael"]["games_with_length"] == 1
    assert rows["Rehgar"]["games_with_length"] == 0
    assert sum(r["games"] for r in out["rows"]) == 3


def test_summarize_by_draft_position_keeps_unknowns(owner: tuple[TestClient, str]) -> None:
    c, token = owner
    out = call_tool(c, token, "summarize", group_by="first_pick")
    rows = {r["key"]: r["games"] for r in out["rows"]}
    assert rows == {False: 1, None: 2}


def test_bad_group_is_refused(owner: tuple[TestClient, str]) -> None:
    c, token = owner
    r = c.post(
        "/mcp",
        headers={
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": "2025-06-18",
            "Authorization": f"Bearer {token}",
        },
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "summarize", "arguments": {"group_by": "carry"}},
        },
    )
    assert r.json()["result"]["isError"] is True


def test_sync_runs_on_use_at_most_every_interval(
    owner: tuple[TestClient, str], fake_hp: FakeHP, clock: Clock
) -> None:
    c, token = owner
    call_tool(c, token, "get_status")
    call_tool(c, token, "list_matches")
    assert list_calls(fake_hp) == 1
    clock.now += 1801
    call_tool(c, token, "list_matches")
    assert list_calls(fake_hp) == 2
    # nothing new: the replay already fetched is not fetched again
    replays = [r for r in fake_hp.requests if f"/replay/{NEWEST}" in r.url.path]
    assert len(replays) == 1


def test_sync_respects_the_shared_list_budget(
    make_client: Callable[..., TestClient], fake_hp: FakeHP, settings: Settings
) -> None:
    fake_hp.responder = hp_routes
    c = make_client(
        mcp_owner_battletag=OWNER, mcp_replay_interval_seconds=0.0, match_daily_budget=0
    )
    token = connect(c)["access_token"]
    s = call_tool(c, token, "get_status")
    assert list_calls(fake_hp) == 0
    assert s["sync"]["last_result"] == "quota_exceeded"
    assert s["games_stored"] == 0


def test_owner_tables_hold_no_other_battletag(
    owner: tuple[TestClient, str], settings: Settings
) -> None:
    c, token = owner
    call_tool(c, token, "get_match", match_id=NEWEST)
    con = sqlite3.connect(settings.db_path)
    try:
        rows = con.execute("SELECT * FROM owner_matches").fetchall()
    finally:
        con.close()
    assert len(rows) == 3
    assert "Other1#1001" not in str(rows)


def test_hero_pool(owner: tuple[TestClient, str]) -> None:
    c, token = owner
    assert call_tool(c, token, "get_hero_pool")["heroes"] == []
    assert (
        c.post("/v1/me/pool", json={"hero": "Rehgar", "in": True}, headers=ORIGIN).status_code
        == 204
    )
    pool = call_tool(c, token, "get_hero_pool")["heroes"]
    assert pool == [{"hero": "Rehgar", "hero_ko": "레가르", "role": "Healer"}]


def test_baseline_for_a_hero(owner: tuple[TestClient, str]) -> None:
    c, token = owner
    b = call_tool(c, token, "get_baseline", hero="말티엘")
    assert b["hero"] == "Malthael"
    assert b["bracket"]["league_tier"]
    overall = b["win_rate"]["all"]
    assert set(overall) >= {"games", "wins", "losses", "win_rate"}
    assert "Dragon Shire" in b["win_rate"]["by_map"]
    assert "hero_damage" in b["average_stats"]
    assert b["patch"]


def test_baseline_needs_a_known_hero(owner: tuple[TestClient, str]) -> None:
    c, token = owner
    assert call_tool(c, token, "get_baseline", hero="Nobody")["error"] == "unknown_hero"

"""Normalising the recorded /players response into the compact profile the page reads."""

from __future__ import annotations

from typing import Any

from server.players.profile import normalize_player
from tests.server.conftest import recorded


def _raw() -> dict[str, Any]:
    body: dict[str, Any] = recorded("v1_players_200.json")["body"]
    return body


def test_career_totals() -> None:
    p = normalize_player(_raw(), battletag="Player12#1012", region="NA")
    assert p["battletag"] == "Player12#1012"
    assert p["region"] == "NA"
    assert p["account_level"] == 9485
    assert (p["wins"], p["losses"], p["win_rate"]) == (1634, 1190, 57.86)
    assert p["kda"] == 5.88
    assert p["mvp_rate"] == 85.81


def test_modes_carry_mmr_and_league_in_a_fixed_order() -> None:
    p = normalize_player(_raw(), battletag="Player12#1012", region="NA")
    modes = {m["mode"]: m for m in p["modes"]}
    # Unranked Draft, Hero League and Team League are gone from the game: their old games are
    # hidden too (owner 2026-10-14), the recorded profile has all six
    assert [m["mode"] for m in p["modes"]] == ["sl", "qm", "ar"]
    assert modes["sl"] == {
        "mode": "sl",
        "mmr": 5524,
        "tier": "Diamond 2",
        "wins": 17,
        "losses": 62,
        "win_rate": 21.52,
    }
    assert modes["qm"]["tier"] == "Master"


def test_modes_without_games_are_dropped() -> None:
    raw = _raw()
    raw["ar_mmr_data"] = {"win": 0, "loss": 0, "mmr": 0, "rank_tier": None, "win_rate": 0}
    raw["qm_mmr_data"] = None
    p = normalize_player(raw, battletag="A#1", region="KR")
    assert [m["mode"] for m in p["modes"]] == ["sl"]


def test_roles_heroes_maps() -> None:
    p = normalize_player(_raw(), battletag="Player12#1012", region="NA")
    assert {r["role"]: r["win_rate"] for r in p["roles"]}["Tank"] == 52.78
    assert len(p["roles"]) == 6
    top = p["heroes_most_played"][0]
    assert top == {
        "hero": "Lúcio",
        "short_name": "lucio",
        "games": 886,
        "wins": 436,
        "losses": 450,
        "win_rate": 49.21,
        "last_played": "2026-09-26 02:32:09",
    }
    assert p["heroes_best"][0]["hero"] == "Ragnaros"
    assert p["maps_most_played"][0] == {
        "map": "Silver City",
        "games": 742,
        "wins": 313,
        "losses": 429,
        "win_rate": 42.2,
    }


def test_recent_matches_are_compact() -> None:
    p = normalize_player(_raw(), battletag="Player12#1012", region="NA")
    ms = p["recent_matches"]
    assert len(ms) == 5
    assert ms[0] == {
        "replay_id": 91585299,
        "date": "2026-09-28 01:20:39",
        "mode": "sl",
        "map": "Volskaya Foundry",
        "hero": "Deckard",
        "short_name": "deckard",
        "win": True,
        "mmr_change": 4.33,
    }
    assert [m["win"] for m in ms] == [True, False, False, True, False]
    # the raw talent objects (≈5 KB per match) are not forwarded
    assert "level_one" not in ms[0]


def test_tolerates_missing_sections() -> None:
    p = normalize_player({"account_level": 5}, battletag="New#1234", region="KR")
    assert p["account_level"] == 5
    assert p["wins"] == 0 and p["win_rate"] is None
    assert p["modes"] == [] and p["recent_matches"] == [] and p["heroes_most_played"] == []
    assert p["roles"] == []


def test_skips_malformed_rows() -> None:
    raw = {
        "heroes_three_most_played": [None, {"hero": None, "games_played": 3}, "x"],
        "matchData": [{"game_type": None, "hero": None, "game_map": None, "winner": 0}],
        "maps_three_most_played": [{"game_map": None}],
    }
    p = normalize_player(raw, battletag="A#1", region="EU")
    assert p["heroes_most_played"] == []
    assert p["maps_most_played"] == []
    assert p["recent_matches"] == [
        {
            "replay_id": None,
            "date": None,
            "mode": None,
            "map": None,
            "hero": None,
            "short_name": None,
            "win": False,
            "mmr_change": None,
        }
    ]

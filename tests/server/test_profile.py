"""Normalising the recorded /players response into the compact profile the page reads."""

from __future__ import annotations

from typing import Any

from server.players.profile import normalize_player
from tests.server.conftest import recorded


def _raw() -> dict[str, Any]:
    body: dict[str, Any] = recorded("v1_players_200.json")["body"]
    return body


def test_career_totals() -> None:
    p = normalize_player(_raw(), battletag="Zemill#1940", region="NA")
    assert p["battletag"] == "Zemill#1940"
    assert p["region"] == "NA"
    assert p["account_level"] == 1802
    assert (p["wins"], p["losses"], p["win_rate"]) == (3502, 3182, 52.39)
    assert p["kda"] == 4.54
    assert p["mvp_rate"] == 17.82


def test_modes_carry_mmr_and_league_in_a_fixed_order() -> None:
    p = normalize_player(_raw(), battletag="Zemill#1940", region="NA")
    modes = {m["mode"]: m for m in p["modes"]}
    # Unranked Draft, Hero League and Team League are gone from the game: their old games are
    # hidden too (owner 2026-10-14), the recorded profile has all six
    assert [m["mode"] for m in p["modes"]] == ["sl", "qm", "ar"]
    assert modes["sl"] == {
        "mode": "sl",
        "mmr": 2908,
        "tier": "Diamond 2",
        "wins": 48,
        "losses": 45,
        "win_rate": 51.61,
    }
    assert modes["qm"]["tier"] == "Master"


def test_modes_without_games_are_dropped() -> None:
    raw = _raw()
    raw["ar_mmr_data"] = {"win": 0, "loss": 0, "mmr": 0, "rank_tier": None, "win_rate": 0}
    raw["qm_mmr_data"] = None
    p = normalize_player(raw, battletag="A#1", region="KR")
    assert [m["mode"] for m in p["modes"]] == ["sl"]


def test_roles_heroes_maps() -> None:
    p = normalize_player(_raw(), battletag="Zemill#1940", region="NA")
    assert {r["role"]: r["win_rate"] for r in p["roles"]}["Tank"] == 48.52
    assert len(p["roles"]) == 6
    top = p["heroes_most_played"][0]
    assert top == {
        "hero": "Lúcio",
        "short_name": "lucio",
        "games": 300,
        "wins": 175,
        "losses": 125,
        "win_rate": 58.33,
        "last_played": "2026-09-26 02:32:09",
    }
    assert p["heroes_best"][0]["hero"] == "Stitches"
    assert p["maps_most_played"][0] == {
        "map": "Braxis Outpost",
        "games": 499,
        "wins": 257,
        "losses": 242,
        "win_rate": 51.5,
    }


def test_recent_matches_are_compact() -> None:
    p = normalize_player(_raw(), battletag="Zemill#1940", region="NA")
    ms = p["recent_matches"]
    assert len(ms) == 5
    assert ms[0] == {
        "replay_id": 65513747,
        "date": "2026-09-28 01:20:39",
        "mode": "sl",
        "map": "Volskaya Foundry",
        "hero": "Deckard",
        "short_name": "deckard",
        "win": True,
        "mmr_change": 2.58,
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

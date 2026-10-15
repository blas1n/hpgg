"""팀 조합 (밴픽 roadmap stage 3): each team's Storm League record by how many healers, front-liners
(tank + bruiser) and ranged assassins it drafted.

Counted from the archived per-game records like 게임 시간대별 승률 (collector/hero_length.py): the
patch's window, each game once, both teams. Measured 2026-10-15 on 10,800 games: no healer 36.9%,
two healers 41.2%, no front-liner 35.6%, three ranged 44.8%."""

from __future__ import annotations

from typing import Any

from collector.team_comps import CAPS, GROUPS, comp_counts

PATCH = "2.57.0"
ROLES = {
    "Anduin": "Healer",
    "Rehgar": "Healer",
    "Muradin": "Tank",
    "Sonya": "Bruiser",
    "Valla": "Ranged Assassin",
    "Jaina": "Ranged Assassin",
    "Raynor": "Ranged Assassin",
    "Zeratul": "Melee Assassin",
    "Abathur": "Support",
}


def _game(
    gid: int, winners: list[str], losers: list[str], version: str = "2.57.0.98348"
) -> dict[str, Any]:
    return {
        "id": gid,
        "version": version,
        "length": 1200,
        "winner": 0,
        "players": [{"team": 0, "hero": h, "win": True} for h in winners]
        + [{"team": 1, "hero": h, "win": False} for h in losers],
    }


STANDARD = ["Anduin", "Muradin", "Sonya", "Valla", "Jaina"]  # 1 healer, 2 front, 2 ranged
NO_HEALER = ["Muradin", "Sonya", "Valla", "Jaina", "Zeratul"]


def test_groups_are_healers_front_liners_and_ranged_assassins() -> None:
    assert GROUPS == {
        "healer": ("Healer",),
        "front": ("Tank", "Bruiser"),
        "ranged": ("Ranged Assassin",),
    }
    assert CAPS == {"healer": 2, "front": 3, "ranged": 3}


def test_each_team_counts_once_by_its_number_of_each_group() -> None:
    out = comp_counts([_game(1, STANDARD, NO_HEALER)], ROLES, patch=PATCH, since=None)
    assert out["games"] == 1 and out["teams"] == 2
    assert out["groups"]["healer"]["1"] == {"games": 1, "wins": 1}
    assert out["groups"]["healer"]["0"] == {"games": 1, "wins": 0}
    assert out["groups"]["front"]["2"] == {"games": 2, "wins": 1}
    assert out["groups"]["ranged"]["2"] == {"games": 2, "wins": 1}


def test_every_count_up_to_the_cap_is_listed_and_the_top_one_holds_the_rest() -> None:
    three_healers = ["Anduin", "Rehgar", "Anduin", "Valla", "Jaina"]
    four_ranged = ["Anduin", "Valla", "Jaina", "Raynor", "Valla"]
    out = comp_counts([_game(1, three_healers, four_ranged)], ROLES, patch=PATCH, since=None)
    assert sorted(out["groups"]["healer"]) == ["0", "1", "2"]
    assert sorted(out["groups"]["front"]) == ["0", "1", "2", "3"]
    assert out["groups"]["healer"]["2"] == {"games": 1, "wins": 1}
    assert out["groups"]["ranged"]["3"] == {"games": 1, "wins": 0}
    assert out["groups"]["front"]["0"] == {"games": 2, "wins": 1}
    assert out["groups"]["front"]["3"] == {"games": 0, "wins": 0}


def test_a_team_with_a_hero_of_no_known_role_or_not_five_players_is_left_out() -> None:
    unknown = ["Anduin", "Muradin", "Sonya", "Valla", "Newhero"]
    four = ["Anduin", "Muradin", "Sonya", "Valla"]
    out = comp_counts(
        [_game(1, STANDARD, unknown), _game(2, four, STANDARD)], ROLES, patch=PATCH, since=None
    )
    assert out["games"] == 2 and out["teams"] == 2
    assert out["groups"]["healer"]["1"] == {"games": 2, "wins": 1}


def test_only_the_window_counts_and_a_game_counts_once() -> None:
    games = [
        _game(1, STANDARD, NO_HEALER, version="2.57.0.98304"),  # before the hotfix
        _game(2, STANDARD, NO_HEALER),
        _game(2, STANDARD, NO_HEALER),  # the same game on two archived days
        _game(3, STANDARD, NO_HEALER, version="2.56.1.98000"),  # another patch
    ]
    out = comp_counts(
        games, ROLES, patch=PATCH, since="2.57.0.98348", collected_at="2026-10-15T18:20:00Z"
    )
    assert out["games"] == 1
    assert out["groups"]["healer"]["0"] == {"games": 1, "wins": 0}
    assert out["patch"] == PATCH and out["since"] == "2.57.0.98348"
    assert out["collected_at"] == "2026-10-15T18:20:00Z"


def test_no_games_still_lists_every_cell() -> None:
    out = comp_counts([], ROLES, patch=PATCH, since=None)
    assert out["games"] == 0 and out["teams"] == 0
    assert out["groups"]["ranged"]["3"] == {"games": 0, "wins": 0}

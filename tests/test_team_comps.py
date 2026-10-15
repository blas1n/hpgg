"""팀 조합 (밴픽 roadmap stage 3): each team's Storm League record by how many healers, front-liners
(tank + bruiser) and ranged assassins it drafted.

Counted from the archived per-game records like 게임 시간대별 승률 (collector/hero_length.py): the
patch's window, each game once, both teams. Measured 2026-10-15 on 10,800 games: no healer 36.9%,
two healers 41.2%, no front-liner 35.6%, three ranged 44.8%."""

from __future__ import annotations

from typing import Any

from collector.team_comps import CAPS, GROUPS, MAKEUP_ROLES, comp_counts, makeup_key

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


def test_a_make_up_is_the_count_of_each_of_the_six_roles_in_a_fixed_order() -> None:
    assert MAKEUP_ROLES == (
        "Tank",
        "Bruiser",
        "Healer",
        "Ranged Assassin",
        "Melee Assassin",
        "Support",
    )
    roles = [ROLES[h] for h in STANDARD]  # Anduin Muradin Sonya Valla Jaina
    assert makeup_key(roles) == "1-1-1-2-0-0"


def test_each_team_counts_under_its_exact_make_up_too() -> None:
    """How often players choose a make-up (owner 2026-10-15: people do it for a reason)."""
    two_tanks = ["Anduin", "Muradin", "Muradin", "Valla", "Jaina"]
    out = comp_counts(
        [_game(1, STANDARD, NO_HEALER), _game(2, two_tanks, STANDARD)],
        ROLES,
        patch=PATCH,
        since=None,
    )
    assert out["makeups"] == {
        "1-1-1-2-0-0": {"games": 2, "wins": 1},
        "1-1-0-2-1-0": {"games": 1, "wins": 0},
        "2-0-1-2-0-0": {"games": 1, "wins": 1},
    }


# --- 실제 역할 (owner 2026-10-15): heroes that also play another role, from the teams around them

FLEX_ROLES = {
    **ROLES,
    "Johanna": "Tank",
    "Arthas": "Tank",
    "Dehaka": "Bruiser",
    "Thrall": "Bruiser",
    "Li Li": "Healer",
    "Malfurion": "Healer",
    "Tracer": "Ranged Assassin",
    "Genji": "Ranged Assassin",
    "Kael'thas": "Ranged Assassin",
    "Illidan": "Melee Assassin",
    "Alarak": "Melee Assassin",
    "Flexy": "Melee Assassin",
    "Abathur": "Support",
}


def _flex_games() -> list[dict[str, Any]]:
    """Melee assassins usually join tank + healer + ranged + support; Flexy, half the time, takes
    the bruiser's place (tank + healer + two ranged around it), else joins tank + bruiser + healer +
    ranged."""
    games: list[dict[str, Any]] = []
    tanks, bruisers, healers = (
        ["Muradin", "Johanna", "Arthas"],
        ["Sonya", "Dehaka", "Thrall"],
        [
            "Anduin",
            "Li Li",
            "Malfurion",
        ],
    )
    ranged = ["Valla", "Jaina", "Raynor", "Tracer", "Genji", "Kael'thas"]
    gid = 0
    for i in range(240):
        t, b, h = tanks[i % 3], bruisers[(i // 3) % 3], healers[(i // 9) % 3]
        r1, r2 = ranged[i % 6], ranged[(i + 1) % 6]
        standard = [t, b, h, r1, r2]  # 1-1-1-2-0-0
        melee = [t, h, r1, ["Illidan", "Alarak"][i % 2], "Abathur"]  # 1-0-1-1-1-1
        # as a melee assassin, or in the bruiser's place
        flexy = [t, b, h, r1, "Flexy"] if i % 2 else [t, h, r1, r2, "Flexy"]
        for a, z in ((standard, melee), (flexy, standard)):
            gid += 1
            games.append(_game(gid, a, z))
    return games


def test_a_hero_whose_teams_look_like_another_roles_teams_plays_that_role_too() -> None:
    from collector.team_comps import played_roles

    out = played_roles(_flex_games(), FLEX_ROLES, min_games=100)
    assert set(out) == {"Flexy"}
    assert out["Flexy"]["second"] == "Bruiser"
    # half its teams are a bruiser's; the other half sit between (a bruiser next to it, no support)
    assert 0.5 <= out["Flexy"]["share"] <= 1
    assert out["Flexy"]["low"] >= 0.2 and out["Flexy"]["games"] == 240


def test_too_few_games_or_a_share_under_a_fifth_is_not_a_second_role() -> None:
    from collector.team_comps import played_roles

    assert played_roles(_flex_games(), FLEX_ROLES, min_games=1000) == {}
    assert played_roles(_flex_games(), FLEX_ROLES, min_games=100, min_share=0.9) == {}


def test_a_flex_hero_counts_in_the_role_that_makes_its_team_the_commoner_make_up() -> None:
    out = comp_counts(_flex_games(), FLEX_ROLES, patch=PATCH, since=None, min_flex_games=100)
    assert out["played"]["Flexy"]["second"] == "Bruiser"
    # Flexy in the bruiser's place counts as the bruiser: no 1-0-1-2-1-0 team is left
    assert "1-0-1-2-1-0" not in out["makeups"]
    assert out["makeups"]["1-1-1-2-0-0"]["games"] == 240 + 240 + 120
    # as a melee assassin next to a bruiser it stays one
    assert out["makeups"]["1-1-1-1-1-0"]["games"] == 120
    assert out["makeups"]["1-0-1-1-1-1"]["games"] == 240
    # front-liners: the melee teams' lone tank only
    assert out["groups"]["front"]["1"]["games"] == 240


def test_cho_and_gall_are_one_hero_of_two_players_and_play_no_second_role() -> None:
    """Gall's teams always hold Cho (a tank): they look like a melee assassin's, by construction."""
    from collector.team_comps import played_roles

    roles = {**FLEX_ROLES, "Cho": "Tank", "Gall": "Ranged Assassin"}
    games = [
        _game(
            i,
            ["Cho", "Gall", "Anduin", "Valla", "Illidan"],
            ["Muradin", "Sonya", "Anduin", "Valla", "Jaina"],
        )
        for i in range(150)
    ]
    out = played_roles(games, roles, min_games=100)
    assert "Gall" not in out and "Cho" not in out

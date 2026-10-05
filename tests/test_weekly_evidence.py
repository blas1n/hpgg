"""The weekly report's evidence (owner 2026-10-05): the facts a Storm League analysis may state,
each with its number and sample — the meta's centre, its specs and average stats against its role,
who holds it down and who it crushes, and how this week's risers and fallers stand against it.
A matchup gap is a finding only on 100+ games and outside the 95 % margin; the rest is a hunch."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tools.weekly_evidence import build_evidence, significant


def _row(hero: str, games: int, wins: int, pick: float, ban: float = 0.0) -> dict[str, Any]:
    wr = wins / games * 100
    return {
        "hero": hero,
        "map": "all",
        "games": games,
        "wins": wins,
        "losses": games - wins,
        "pick": pick,
        "ban_rate": ban,
        "popularity": pick + ban,
        "win_rate": wr,
        "tier_win_rate": wr,
        "bans": 0,
        "ci": None,
    }


def _data(tmp: Path) -> Path:
    d = tmp / "data"
    (d / "weekly").mkdir(parents=True)
    (d / "matchups").mkdir()
    (d / "latest").mkdir()
    heroes = [
        ("Xal'atath", "xal-atath", "Ranged Assassin", "원거리 암살자"),
        ("Valla", "valla", "Ranged Assassin", "원거리 암살자"),
        ("Tyrael", "tyrael", "Bruiser", "투사"),
        ("Diablo", "diablo", "Tank", "전사"),
    ]
    (d / "heroes_ko.json").write_text(
        json.dumps(
            {
                "roles": [],
                "heroes": [
                    {"name": n, "slug": s, "ko": n + "ko", "role": r, "role_ko": rk}
                    for n, s, r, rk in heroes
                ],
            }
        )
    )
    window = [
        _row("Xal'atath", 2000, 1340, 20, 80),
        _row("Valla", 1000, 470, 10),
        _row("Tyrael", 1500, 810, 15),
        _row("Diablo", 900, 400, 9),
    ]
    baseline = [
        _row("Valla", 1000, 520, 10),
        _row("Tyrael", 1500, 700, 15),
        _row("Diablo", 900, 470, 9),
    ]
    snap = lambda rows: {"patch": "2.57.0", "mode": "sl", "matches": 10000, "rows": rows}  # noqa: E731
    issue = {
        "week": "2026-w40",
        "kind": "patch_start",
        "start": "2026-09-29",
        "end": "2026-10-05",
        "patch": "2.57.0",
        "collected_at": "c",
        "baseline": {"kind": "previous_patch", "patch": "2.55.17"},
        "views": {"sl": {"window": snap(window), "baseline": snap(baseline)}},
        "daily": {"sl": []},
    }
    (d / "weekly" / "2026-w40.json").write_text(json.dumps(issue))
    # Xal'atath: 67 % overall; 58 % against Tyrael on 142 games (a finding), 80 % against
    # Diablo on 153, 55 % against Valla on 20 (a hunch)
    (d / "matchups" / "xal-atath.json").write_text(
        json.dumps(
            {
                "hero": "Xal'atath",
                "patch": "2.57.0",
                "games": 2000,
                "wins": 1340,
                "win_rate": 67.0,
                "ally": [],
                "enemy": [
                    {"hero": "Tyrael", "games": 142, "wins": 82, "win_rate": 57.75},
                    {"hero": "Diablo", "games": 153, "wins": 122, "win_rate": 79.74},
                    {"hero": "Valla", "games": 20, "wins": 11, "win_rate": 55.0},
                ],
            }
        )
    )
    (d / "hero_specs.json").write_text(
        json.dumps(
            {
                "heroes": {
                    "xal-atath": {
                        "life": 1330,
                        "melee": False,
                        "attack_range": 6.5,
                        "ratings": {"damage": 8, "survivability": 6, "utility": 6, "complexity": 8},
                    },
                    "valla": {
                        "life": 1340,
                        "melee": False,
                        "attack_range": 5.5,
                        "ratings": {"damage": 9, "survivability": 4, "utility": 1, "complexity": 3},
                    },
                    "tyrael": {
                        "life": 2517,
                        "melee": True,
                        "attack_range": 1.5,
                        "ratings": {"damage": 6, "survivability": 8, "utility": 6, "complexity": 5},
                    },
                    "diablo": {
                        "life": 2825,
                        "melee": True,
                        "attack_range": 1.25,
                        "ratings": {"damage": 5, "survivability": 9, "utility": 7, "complexity": 5},
                    },
                }
            }
        )
    )
    (d / "latest" / "sl_averages.json").write_text(
        json.dumps(
            {
                "patch": "2.57.0",
                "stats": {
                    "hero_damage": {
                        "Xal'atath": 72730,
                        "Valla": 66951,
                        "Tyrael": 44932,
                        "Diablo": 38978,
                    },
                    "damage_taken": {
                        "Xal'atath": 40000,
                        "Valla": 38000,
                        "Tyrael": 90000,
                        "Diablo": 110000,
                    },
                    "deaths": {"Xal'atath": 3.1, "Valla": 4.2, "Tyrael": 3.5, "Diablo": 3.0},
                },
                "average": {"hero_damage": 47089},
                "games": {},
            }
        )
    )
    # the patch's own changes: a mover's change may be the patch, not the meta (Tyrael buffed here)
    (d / "patchnotes.json").write_text(
        json.dumps(
            {
                "notes": [
                    {
                        "id": "a",
                        "build": "2.57.0.98285",
                        "published": "p",
                        "title": {"ko": "", "en": ""},
                        "url": {"ko": "", "en": ""},
                        "heroes": {"Tyrael": {"verdict": "buff", "groups": []}},
                    },
                    {
                        "id": "o",
                        "build": "2.55.17.97605",
                        "published": "p",
                        "title": {"ko": "", "en": ""},
                        "url": {"ko": "", "en": ""},
                        "heroes": {"Diablo": {"verdict": "nerf", "groups": []}},
                    },
                ]
            }
        )
    )
    (d / "hotfixes.json").write_text(
        json.dumps(
            {
                "builds": [
                    {
                        "build": "2.57.0.98304",
                        "previous": "2.57.0.98285",
                        "first_seen": "f",
                        "parser": 1,
                        "heroes": {"Valla": [{"kind": "talent"}]},
                    },
                ]
            }
        )
    )
    return d


def test_a_mover_carries_this_patchs_change_to_it(tmp_path: Path) -> None:
    ev = build_evidence(_data(tmp_path), "2026-w40")
    up = {x["hero"]: x for x in ev["risers"]}
    down = {x["hero"]: x for x in ev["fallers"]}
    assert up["Tyrael"]["patch_change"] == "buff"
    assert down["Diablo"]["patch_change"] is None  # a note of the previous patch is not this patch
    assert down["Valla"]["patch_change"] == "hotfix"


def test_a_gap_is_a_finding_only_with_games_and_outside_the_margin() -> None:
    assert significant(delta=-9.2, base=67.0, games=142)
    assert not significant(delta=-12.0, base=67.0, games=20)  # few games
    assert not significant(delta=-2.0, base=67.0, games=500)  # inside the margin


def test_the_centre_is_the_most_present_hero(tmp_path: Path) -> None:
    ev = build_evidence(_data(tmp_path), "2026-w40")
    c = ev["centre"]
    assert c["hero"] == "Xal'atath" and c["presence"] == pytest.approx(100.0)
    assert c["win_rate"] == pytest.approx(67.0) and c["games"] == 2000


def test_the_centre_profile_places_specs_and_averages_in_its_role_and_overall(
    tmp_path: Path,
) -> None:
    p = build_evidence(_data(tmp_path), "2026-w40")["centre"]["profile"]
    assert p["specs"]["life"] == 1330 and p["specs"]["ratings"]["survivability"] == 6
    hd = p["averages"]["hero_damage"]
    assert (
        hd["value"] == 72730 and hd["rank_all"] == 1 and hd["rank_role"] == 1 and hd["of_role"] == 2
    )
    assert p["life_rank_role"] == {"rank": 2, "of": 2}  # life, highest first: Valla 1340, Xal 1330


def test_matchups_split_findings_from_hunches(tmp_path: Path) -> None:
    m = build_evidence(_data(tmp_path), "2026-w40")["centre"]["matchups"]
    held = {x["hero"]: x for x in m["held_by"]}
    crushed = {x["hero"]: x for x in m["crushes"]}
    assert held["Tyrael"]["significant"] and held["Tyrael"]["delta"] == pytest.approx(57.75 - 67.0)
    assert crushed["Diablo"]["significant"]
    assert not held["Valla"]["significant"]  # 20 games: a hunch, said as one


def test_movers_carry_their_matchup_with_the_centre(tmp_path: Path) -> None:
    ev = build_evidence(_data(tmp_path), "2026-w40")
    up = {x["hero"]: x for x in ev["risers"]}
    down = {x["hero"]: x for x in ev["fallers"]}
    assert "Tyrael" in up and up["Tyrael"]["vs_centre"]["significant"]
    assert "Diablo" in down and down["Diablo"]["vs_centre"]["delta"] > 0  # the centre crushes it
    assert up["Tyrael"]["role"] == "Bruiser"
    assert ev["mode"] == "sl" and ev["week"] == "2026-w40"
    assert ev["new_heroes"] == ["Xal'atath"]

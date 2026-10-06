"""몇인분's yardstick (owner 2026-10-06: "같은 역할 평균이 아니라, 같은 영웅 평균으로").

Each hero's usual output per minute (takedowns, hero damage, siege damage, experience, healing +
damage taken, crowd control, shields, camps and towers, time dead) from the daily replay sample,
the recent days weighing more. A hero with too few games falls back to its role."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from collector.carry_baselines import STATS, update_baselines


def _game(gid: int, length: int, rows: list[tuple[str, dict[str, float]]]) -> dict[str, Any]:
    return {
        "id": gid,
        "length": length,
        "players": [
            {"team": i // 5, "hero": h, "score": {k: s.get(k, 0) for k in _KEYS}}
            for i, (h, s) in enumerate(rows)
        ],
    }


_KEYS = (
    "takedowns",
    "hero_damage",
    "siege_damage",
    "experience_contribution",
    "healing",
    "damage_taken",
    "stunning_enemies",
    "rooting_enemies",
    "silencing_enemies",
    "protection_allies",
    "merc_camp_captures",
    "watch_tower_captures",
    "time_spent_dead",
)
ROLES = {"Valla": "Ranged Assassin", "Muradin": "Tank", "Rare": "Tank"}


def test_a_heros_yardstick_is_its_output_per_minute(tmp_path: Path) -> None:
    p = tmp_path / "carry_baselines.json"
    games = [
        _game(
            1,
            600,
            [("Valla", {"hero_damage": 30000, "takedowns": 10})]
            + [("Muradin", {"damage_taken": 60000})] * 9,
        ),
        _game(
            2,
            1200,
            [("Valla", {"hero_damage": 30000, "takedowns": 10})]
            + [("Muradin", {"damage_taken": 60000})] * 9,
        ),
    ]
    update_baselines(p, games, roles=ROLES, min_games=2, day="2026-10-07")
    b = json.loads(p.read_text())
    valla = b["heroes"]["Valla"]
    assert valla["games"] == pytest.approx(2)
    assert valla["per_min"]["dmg"] == pytest.approx((3000 + 1500) / 2)  # 30k in 10 min, then in 20
    assert valla["per_min"]["td"] == pytest.approx((1.0 + 0.5) / 2)
    assert set(valla["per_min"]) == set(STATS)
    assert b["roles"]["Tank"]["per_min"]["sus"] > 0
    assert b["all"]["dmg"] > 0 and b["updated"] == "2026-10-07"


def test_older_days_weigh_less_and_a_rare_hero_uses_its_role(tmp_path: Path) -> None:
    p = tmp_path / "carry_baselines.json"
    old = [_game(1, 600, [("Valla", {"hero_damage": 60000})] + [("Muradin", {})] * 9)]
    new = [
        _game(
            2,
            600,
            [("Valla", {"hero_damage": 30000})]
            + [("Muradin", {})] * 8
            + [("Rare", {"damage_taken": 6000})],
        )
    ]
    update_baselines(p, old, roles=ROLES, min_games=1, day="2026-10-06", decay=0.5)
    update_baselines(p, new, roles=ROLES, min_games=1.5, day="2026-10-07", decay=0.5)
    b = json.loads(p.read_text())
    # old day 6000/min at half weight, new day 3000/min at full: (0.5·6000 + 3000) / 1.5
    assert b["heroes"]["Valla"]["per_min"]["dmg"] == pytest.approx(4000)
    assert b["heroes"]["Valla"]["games"] == pytest.approx(1.5)
    assert "Rare" not in b["heroes"]  # one game: under min_games, the page falls back to Tank
    assert b["roles"]["Tank"]["games"] > 0

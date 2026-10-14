"""티어별 승률 (owner 2026-10-13): each hero's Storm League win rate in each league tier.

Six calls, one per league tier (1 bronze … 6 master, grandmasters inside master), each with its
solo twin for the party correction, about once a week on the spare Heroes/Stats quota. Probe on
2.57.0.98348 (2026-10-13): median 97 games a hero in bronze, ~330 in gold and platinum, 121 in
master; 28 of 91 heroes' win rates move with the tier beyond the error (~4 by chance)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from collector.tiers import TIERS, due, tiers_file


def _snap(rows: list[tuple[str, str, int, int]], tier: int, matches: int = 100) -> dict[str, Any]:
    return {
        "patch": "2.57.0",
        "league_tier": [tier],
        "matches": matches,
        "rows": [
            {"hero": h, "map": m, "wins": w, "losses": n - w, "games": n, "win_rate": w / n * 100}
            for h, m, w, n in rows
        ],
    }


def test_the_tiers_are_bronze_to_master() -> None:
    assert TIERS == (1, 2, 3, 4, 5, 6)


def test_each_hero_gets_one_point_per_tier_corrected_for_parties_whole_map_only() -> None:
    snaps = {
        t: _snap([("Valla", "all", 50 + t, 100), ("Valla", "Garden of Terror", 9, 10)], t, 100 * t)
        for t in TIERS
    }
    # every solo game a loss but Valla's: pooled solo rate far under 50, Valla corrected upward
    solos = {t: _snap([("Valla", "all", 30, 60), ("Muradin", "all", 10, 60)], t) for t in TIERS}
    out = tiers_file(
        snaps, solos, patch="2.57.0", since="2.57.0.98348", collected_at="2026-10-13T00:00:00Z"
    )
    assert out["patch"] == "2.57.0" and out["since"] == "2.57.0.98348"
    assert out["tiers"] == [1, 2, 3, 4, 5, 6]
    assert out["matches"] == [100, 200, 300, 400, 500, 600]
    valla = out["heroes"]["Valla"]
    assert len(valla) == 6
    assert valla[0]["games"] == 100 and valla[0]["wins"] == 51
    assert valla[0]["win_rate"] == 51.0
    assert valla[0]["tier_win_rate"] > valla[0]["win_rate"]


def test_a_hero_missing_in_a_tier_has_no_point_there() -> None:
    snaps = {
        t: _snap([("Valla", "all", 5, 10)] + ([("Gall", "all", 3, 6)] if t > 2 else []), t)
        for t in TIERS
    }
    solos = {t: _snap([("Valla", "all", 5, 10)], t) for t in TIERS}
    out = tiers_file(snaps, solos, patch="2.57.0", since=None, collected_at="x")
    assert out["heroes"]["Gall"][:2] == [None, None]
    assert out["heroes"]["Gall"][2]["games"] == 6


def test_due_once_a_week_and_again_when_the_patch_or_its_window_changes(tmp_path: Path) -> None:
    p = tmp_path / "sl_tiers.json"
    at = "2026-10-13T18:20:00Z"
    assert due(p, patch="2.57.0", since="2.57.0.98348", collected_at=at)
    p.write_text(json.dumps({"patch": "2.57.0", "since": "2.57.0.98348", "collected_at": at}))
    assert not due(p, patch="2.57.0", since="2.57.0.98348", collected_at="2026-10-18T18:20:00Z")
    assert due(p, patch="2.57.0", since="2.57.0.98348", collected_at="2026-10-19T18:20:00Z")
    assert due(p, patch="2.57.0", since="2.57.0.99000", collected_at="2026-10-14T18:20:00Z")
    assert due(p, patch="2.58.0", since=None, collected_at="2026-10-14T18:20:00Z")

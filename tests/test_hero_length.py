"""게임 시간대별 승률 (roadmap stage 2): each hero's Storm League record by game length.

Counted from the archived per-game records (collector/replay_sample.py, the snapshots branch) of
the patch's current window (a settled balance hotfix restarts the count, owner 2026-10-07). A hero
leans early or late only when its short-game and long-game rates differ beyond the error."""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

from collector.hero_length import band_of, length_rates, load_archive

PATCH = "2.57.0"


def _game(
    gid: int,
    length: int,
    winners: list[str],
    losers: list[str],
    version: str = "2.57.0.98348",
) -> dict[str, Any]:
    return {
        "id": gid,
        "version": version,
        "length": length,
        "winner": 0,
        "players": [{"team": 0, "hero": h, "win": True} for h in winners]
        + [{"team": 1, "hero": h, "win": False} for h in losers],
    }


def test_bands_are_up_to_15_minutes_15_to_20_and_over_20() -> None:
    assert band_of(900) == "short"
    assert band_of(901) == "mid"
    assert band_of(1200) == "mid"
    assert band_of(1201) == "long"


def test_each_hero_counts_games_and_wins_per_band_on_both_teams() -> None:
    games = [
        _game(1, 600, ["Valla"], ["Muradin"]),
        _game(2, 1000, ["Muradin"], ["Valla"]),
        _game(3, 1500, ["Valla"], ["Muradin"]),
    ]
    out = length_rates(games, patch=PATCH, since=None)
    assert out["games"] == 3
    assert out["bands"] == {"short": 1, "mid": 1, "long": 1}
    assert out["heroes"]["Valla"]["short"] == {"games": 1, "wins": 1}
    assert out["heroes"]["Valla"]["mid"] == {"games": 1, "wins": 0}
    assert out["heroes"]["Muradin"]["long"] == {"games": 1, "wins": 0}


def test_only_the_window_counts_other_patches_and_builds_before_the_hotfix_do_not() -> None:
    games = [
        _game(1, 600, ["Valla"], ["Muradin"], version="2.57.0.98304"),  # before the hotfix
        _game(2, 600, ["Valla"], ["Muradin"], version="2.57.0.98348"),
        _game(3, 600, ["Valla"], ["Muradin"], version="2.57.1.99000"),  # another patch
        _game(4, 600, ["Valla"], ["Muradin"], version="2.55.17.98025"),
    ]
    out = length_rates(games, patch=PATCH, since="2.57.0.98348")
    assert out["games"] == 1
    assert out["since"] == "2.57.0.98348"
    # no settled hotfix: the whole patch
    assert length_rates(games, patch=PATCH, since=None)["games"] == 2
    # a window of another patch (the reference patch is the previous one) narrows nothing
    assert length_rates(games, patch=PATCH, since="2.57.1.99000")["games"] == 2


def test_a_game_is_counted_once_whatever_the_order() -> None:
    g = _game(1, 600, ["Valla"], ["Muradin"])
    assert length_rates([g, dict(g)], patch=PATCH, since=None)["games"] == 1


def _many(hero: str, band_len: int, wins: int, losses: int, start: int) -> list[dict[str, Any]]:
    return [_game(start + i, band_len, [hero], ["Muradin"]) for i in range(wins)] + [
        _game(start + wins + i, band_len, ["Muradin"], [hero]) for i in range(losses)
    ]


def test_a_hero_leans_late_or_early_only_beyond_the_error() -> None:
    games = (
        _many("Abathur", 600, 40, 60, 0)  # short 40 %
        + _many("Abathur", 1500, 60, 40, 1000)  # long 60 %
        + _many("Stukov", 600, 60, 40, 2000)
        + _many("Stukov", 1500, 40, 60, 3000)
        + _many("Valla", 600, 48, 52, 4000)  # 48 % vs 52 %: inside the error
        + _many("Valla", 1500, 52, 48, 5000)
    )
    heroes = length_rates(games, patch=PATCH, since=None)["heroes"]
    assert heroes["Abathur"]["lean"] == "late"
    assert heroes["Stukov"]["lean"] == "early"
    assert heroes["Valla"]["lean"] is None


def test_no_lean_under_30_games_in_a_band_however_wide_the_gap() -> None:
    games = _many("Medivh", 600, 0, 29, 0) + _many("Medivh", 1500, 29, 0, 100)
    assert length_rates(games, patch=PATCH, since=None)["heroes"]["Medivh"]["lean"] is None


def _write_day(root: Path, day: str, kind: str, games: list[dict[str, Any]]) -> None:
    d = root / day
    d.mkdir(parents=True, exist_ok=True)
    with gzip.open(d / f"replays_{kind}.jsonl.gz", "wt", encoding="utf-8") as f:
        for g in games:
            f.write(json.dumps(g) + "\n")


def test_the_archive_is_every_days_storm_league_records_once(tmp_path: Path) -> None:
    archive = tmp_path / "snapshots"
    _write_day(archive, "2026-10-07", "sl", [_game(1, 600, ["Valla"], ["Muradin"])])
    _write_day(archive, "2026-10-08", "sl", [_game(2, 600, ["Valla"], ["Muradin"])])
    _write_day(archive, "2026-10-08", "qm", [_game(3, 600, ["Valla"], ["Muradin"])])
    today = tmp_path / "out"
    # today's folder may repeat a game the archive has (a second run the same day)
    _write_day(
        today,
        "2026-10-09",
        "sl",
        [_game(2, 600, ["Valla"], ["Muradin"]), _game(4, 600, ["Valla"], ["Muradin"])],
    )
    games = load_archive([archive, today, tmp_path / "missing"])
    assert sorted(g["id"] for g in games) == [1, 2, 4]

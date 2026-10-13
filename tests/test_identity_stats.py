"""영웅별 주요 스탯 (owner 2026-10-12): what sets a hero apart, beyond the card's stat line.

From the archived replay records, each hero's per-minute average of every candidate stat is set
against all heroes' (in standard deviations); the ones far above, at least 1.5 times the all-hero
average, up to three, strongest first. The card's own stats (K/D/A, hero and siege damage, healing,
damage taken, experience) are not candidates, nor vengeance (owner: says nothing of the hero) or
time_cc_enemy_heroes (always 0 from Heroes Profile)."""

from __future__ import annotations

from typing import Any

import pytest

from collector.identity_stats import CANDIDATES, identity_stats

DAY = "2026-10-12T18:25:00Z"


def _game(
    gid: int,
    rows: list[tuple[str, dict[str, float]]],
    *,
    length: int = 600,
    date: str = "2026-10-10 12:00:00",
) -> dict[str, Any]:
    return {
        "id": gid,
        "date": date,
        "length": length,
        "players": [{"hero": h, "score": s} for h, s in rows],
    }


def _field(stat: str) -> str:
    return CANDIDATES[stat]


def _games(n: int, rows: list[tuple[str, dict[str, float]]], **kw: Any) -> list[dict[str, Any]]:
    return [_game(i, rows, **kw) for i in range(n)]


def test_a_hero_far_above_everyone_on_a_stat_gets_it_with_its_per_game_average() -> None:
    # only Ana makes clutch heals; Muradin stuns too, so Ana's stuns stand out less
    rows = [
        ("Ana", {_field("stuns"): 60, _field("clutch_heals"): 4}),
        ("Muradin", {_field("stuns"): 50}),
    ] + [("Valla", {_field("stuns"): 2})] * 8
    out = identity_stats(_games(30, rows), collected_at=DAY, min_games=20)
    ana = out["heroes"]["Ana"]
    assert [s["stat"] for s in ana["stats"]] == ["clutch_heals", "stuns"]  # strongest first
    stuns = ana["stats"][1]
    assert stuns["avg"] == pytest.approx(60)  # per game, what the card compares with
    assert stuns["ratio"] == pytest.approx(60 / ((60 + 50 + 8 * 2) / 10), abs=0.01)
    assert "Valla" not in out["heroes"]  # nothing of Valla stands out
    assert out["games"] == 30


def test_at_most_three_and_none_under_one_and_a_half_times() -> None:
    lots = {_field(s): 100 for s in ("stuns", "roots", "silences", "shields")}
    rows = [("Malfurion", lots), ("Muradin", {_field("self_healing"): 1.4})] + [
        ("Valla", {_field("self_healing"): 1})
    ] * 8
    out = identity_stats(_games(30, rows), collected_at=DAY, min_games=20)
    assert len(out["heroes"]["Malfurion"]["stats"]) == 3
    # Muradin's self healing: 1.4 against an average of ~1.04 — above, but not 1.5 times
    assert "Muradin" not in out["heroes"]


def test_only_candidates_count_never_the_cards_own_stats_or_vengeance() -> None:
    assert "vengeance" not in CANDIDATES.values()
    assert "time_cc_enemy_heroes" not in CANDIDATES.values()
    # owner 2026-10-13: what the card's numbers do not show — crowd control, self healing, shields,
    # clutch heals; not on fire or escapes (luck), nor merc / structure damage (in siege damage)
    assert set(CANDIDATES) == {
        "stuns",
        "roots",
        "silences",
        "self_healing",
        "shields",
        "clutch_heals",
    }
    for dropped in (
        "time_on_fire",
        "escapes",
        "teamfight_escapes",
        "creep_damage",
        "structure_damage",
    ):
        assert dropped not in CANDIDATES.values()
    for shown in (
        "hero_damage",
        "siege_damage",
        "healing",
        "damage_taken",
        "experience_contribution",
        "kills",
    ):
        assert shown not in CANDIDATES.values()
    rows = [("Butcher", {"vengeance": 50, "hero_damage": 900000})] + [("Valla", {})] * 9
    out = identity_stats(_games(30, rows), collected_at=DAY, min_games=20)
    assert "Butcher" not in out["heroes"]


def test_per_minute_so_long_games_do_not_look_big() -> None:
    # 10 self healing a minute for everyone; Leoric only ever in 40-minute games
    sh = _field("self_healing")
    long_ = _games(30, [("Leoric", {sh: 400})] + [("Valla", {sh: 400})] * 9, length=2400)
    short = [_game(100 + i, [("Valla", {sh: 100})] * 10) for i in range(30)]
    out = identity_stats(long_ + short, collected_at=DAY, min_games=20)
    assert "Leoric" not in out["heroes"]


def test_a_hero_with_too_few_games_is_left_out() -> None:
    rows = [("Ana", {_field("stuns"): 60})] + [("Valla", {})] * 9
    assert "Ana" not in identity_stats(_games(10, rows), collected_at=DAY, min_games=20)["heroes"]


def test_only_the_window_counts_and_each_game_once() -> None:
    rows = [("Ana", {_field("stuns"): 60})] + [("Valla", {})] * 9
    old = _games(30, rows, date="2026-08-01 12:00:00")
    out = identity_stats(old, collected_at=DAY, min_games=20, days=28)
    assert out["games"] == 0 and out["heroes"] == {}
    recent = _games(30, rows)
    out = identity_stats(recent + recent, collected_at=DAY, min_games=20, days=28)
    assert out["games"] == 30
    assert out["since"] == "2026-09-14"


def test_a_malformed_record_is_skipped() -> None:
    rows = [("Ana", {_field("stuns"): 60})] + [("Valla", {})] * 9
    bad = [{"id": 999, "date": "2026-10-10 12:00:00", "length": None, "players": None}, {"id": 998}]
    out = identity_stats(_games(30, rows) + bad, collected_at=DAY, min_games=20)
    assert out["games"] == 30 and "Ana" in out["heroes"]


def test_every_candidate_is_a_field_of_the_match_rows_the_card_reads() -> None:
    from server.players.match_rows import STATS

    for ours, theirs in CANDIDATES.items():
        assert STATS.get(ours) == theirs

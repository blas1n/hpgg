from __future__ import annotations

import copy
from typing import Any

import pytest

from collector.party import PARTY_K, apply_party_correction


def _snap(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {"patch": "2.55.17.97771", "mode": "qm", "rows": rows}


def _row(hero: str, wins: int, games: int, map_name: str = "all") -> dict[str, Any]:
    return {
        "hero": hero,
        "map": map_name,
        "wins": wins,
        "losses": games - wins,
        "games": games,
        "win_rate": round(wins / games * 100, 4),
    }


@pytest.fixture
def base() -> dict[str, Any]:
    return _snap(
        [
            _row("Garrosh", 550, 1000),
            _row("Nova", 450, 1000),
            _row("Cho", 500, 400),  # a duo hero: never in the solo data
            _row("Garrosh", 60, 100, map_name="Cursed Hollow"),
        ]
    )


@pytest.fixture
def solo() -> dict[str, Any]:
    # pooled solo WR = (400 + 360) / 1600 = 47.5 % → every solo WR is read 2.5 %p higher
    return _snap([_row("Garrosh", 400, 800), _row("Nova", 360, 800)])


def test_k_is_the_owner_decision() -> None:
    assert PARTY_K == 1000


def test_tier_win_rate_moves_toward_the_centred_solo_rate_by_the_solo_sample(
    base: dict[str, Any], solo: dict[str, Any]
) -> None:
    out = apply_party_correction(base, solo)
    by = {r["hero"]: r for r in out["rows"] if r["map"] == "all"}
    # Garrosh: centred solo 50 + 2.5 = 52.5, gap −2.5, weight 800/1800
    assert by["Garrosh"]["tier_win_rate"] == pytest.approx(55 - 2.5 * 800 / 1800, abs=1e-4)
    # Nova: centred solo 45 + 2.5 = 47.5, gap +2.5
    assert by["Nova"]["tier_win_rate"] == pytest.approx(45 + 2.5 * 800 / 1800, abs=1e-4)
    # the shown win rate is untouched
    assert by["Garrosh"]["win_rate"] == 55.0 and by["Nova"]["win_rate"] == 45.0


def test_hero_without_solo_games_keeps_its_own_win_rate(
    base: dict[str, Any], solo: dict[str, Any]
) -> None:
    out = apply_party_correction(base, solo)
    cho = next(r for r in out["rows"] if r["hero"] == "Cho")
    assert cho["tier_win_rate"] == cho["win_rate"]


def test_per_map_rows_are_corrected_by_that_maps_solo_games(base: dict[str, Any]) -> None:
    """Owner 2026-10-02: the correction is part of the formula, so every view carries it — a
    map's rows by that map's solo games and its own pooled solo rate."""
    solo = _snap(
        [
            _row("Garrosh", 400, 800),
            _row("Nova", 360, 800),
            _row("Garrosh", 40, 80, map_name="Cursed Hollow"),
            _row("Nova", 36, 80, map_name="Cursed Hollow"),  # map pool 76/160 = 47.5 %
        ]
    )
    out = apply_party_correction(base, solo)
    ch = next(r for r in out["rows"] if r["map"] == "Cursed Hollow")
    # Garrosh on the map: 60 %, centred solo 50 + 2.5 = 52.5, weight 80/1080
    assert ch["tier_win_rate"] == pytest.approx(60 - 7.5 * 80 / 1080, abs=1e-4)


def test_a_map_without_solo_games_keeps_its_own_win_rate(
    base: dict[str, Any], solo: dict[str, Any]
) -> None:
    out = apply_party_correction(base, solo)
    ch = next(r for r in out["rows"] if r["map"] == "Cursed Hollow")
    assert ch["tier_win_rate"] == ch["win_rate"]


def test_party_block_carries_what_the_page_prints(
    base: dict[str, Any], solo: dict[str, Any]
) -> None:
    out = apply_party_correction(base, solo)
    assert out["party"] == {"k": 1000, "solo_pooled": 47.5, "solo_games": 1600}


def test_input_is_not_mutated(base: dict[str, Any], solo: dict[str, Any]) -> None:
    before = copy.deepcopy(base)
    apply_party_correction(base, solo)
    assert base == before


def test_solo_data_for_another_patch_is_refused(base: dict[str, Any], solo: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match="patch"):
        apply_party_correction(base, {**solo, "patch": "2.57.0.98285"})


def test_empty_solo_data_is_refused(base: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match="solo"):
        apply_party_correction(base, _snap([]))

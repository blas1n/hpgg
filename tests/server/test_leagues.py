"""A game's league tier from its MMR (server/players/leagues.py).

HP's `/players/mmr/history` lists one game type's league ranges (`league_tiers`): every league as
one row, the player's own league split into its five divisions. HP's `/mmr/tier` places a rating
in those ranges, the five divisions of a league being equal parts of it, Master undivided —
measured against `/mmr/tier` for Storm League on 2026-10-13 (the expectations below).
"""

from __future__ import annotations

import pytest

from server.players.leagues import league_floors, tier_of
from tests.server.conftest import recorded

# Storm League floors read from /players/mmr/history on 2026-10-13 (KR and NA answered the same)
SL = [1209.0, 2447.0, 2584.0, 2701.0, 2826.0, 2962.0]


def test_floors_come_from_every_league_whether_split_or_not() -> None:
    body = recorded("v1_players_mmr_history_200.json")["body"]
    # Bronze arrives as five division rows (the player's league), the rest as one row each
    assert league_floors(body) == [785.0, 2439.0, 2555.0, 2643.0, 2728.0, 2821.0]


@pytest.mark.parametrize(
    "body",
    [
        None,
        {},
        {"league_tiers": []},
        {"league_tiers": "x"},
        # a league missing: the divisions of its neighbour cannot be placed
        {"league_tiers": [{"league_tier": t, "min_mmr": 1000 + t} for t in (1, 2, 3, 4, 6)]},
        {"league_tiers": [{"league_tier": t, "min_mmr": "x"} for t in range(1, 7)]},
    ],
)
def test_no_floors_from_an_answer_without_all_six_leagues(body: object) -> None:
    assert league_floors(body) is None


@pytest.mark.parametrize(
    ("mmr", "tier"),
    [
        (1000, "Bronze 5"),  # under the lowest floor
        (2000, "Bronze 2"),
        (2446, "Bronze 1"),
        (2447, "Silver 5"),  # a floor belongs to the league above
        (2500, "Silver 4"),
        (2600, "Gold 5"),
        (2700, "Gold 1"),
        (2725, "Platinum 5"),
        (2726, "Platinum 4"),
        (2750, "Platinum 4"),
        (2800, "Platinum 2"),
        (2850, "Diamond 5"),
        (2853, "Diamond 5"),
        (2854, "Diamond 4"),
        (2908, "Diamond 2"),
        (2961, "Diamond 1"),
        (2962, "Master"),
        (3200, "Master"),
    ],
)
def test_tier_matches_hp_mmr_tier(mmr: int, tier: str) -> None:
    assert tier_of(mmr, SL) == tier

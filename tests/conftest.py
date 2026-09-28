from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

FIXTURES = Path(__file__).parent / "fixtures"
BASE = "https://api.test.invalid/v1"
TOKEN = "SECRET-TOKEN-abc123XYZ"


def _row(
    name: str,
    wins: int,
    losses: int,
    bans: int = 0,
    matches: int = 1000,
    ci: float | None = 1.5,
) -> dict[str, Any]:
    games = wins + losses
    row: dict[str, Any] = {
        "name": name,
        "short_name": name.lower(),
        "hero_id": abs(hash(name)) % 1000,
        "role": "Tank",
        "wins": wins,
        "losses": losses,
        "games_played": games,
        "bans": bans,
        "win_rate": round(wins / games * 100, 2) if games else 0.0,
        "pick_rate": round(games / matches * 100, 2),
        "ban_rate": round(bans / matches * 100, 2),
        "popularity": round((games + bans) / matches * 100, 2),
    }
    if ci is not None:
        row["confidence_interval"] = ci
    return row


@pytest.fixture
def raw_by_map() -> dict[str, Any]:
    """A plausible v1 `group_by_map=true` payload: keyed by map name, each with averages + data."""
    return {
        "Cursed Hollow": {
            "average_win_rate": 50.0,
            "data": [
                _row("Illidan", 60, 40, bans=10, matches=100),
                _row("Brightwing", 45, 55, bans=30, matches=100),
                _row("Probius", 3, 2, bans=0, matches=100),
            ],
        },
        "Dragon Shire": {
            "average_win_rate": 50.0,
            "data": [
                _row("Illidan", 100, 100, bans=20, matches=200),
                _row("Brightwing", 90, 110, bans=40, matches=200),
            ],
        },
    }


@pytest.fixture
def patches_payload() -> dict[str, Any]:
    return json.loads((FIXTURES / "v1_patches_sample.json").read_text())


@pytest.fixture
def fake_sleep() -> Any:
    class _Sleep:
        def __init__(self) -> None:
            self.calls: list[float] = []

        async def __call__(self, seconds: float) -> None:
            self.calls.append(seconds)

    return _Sleep()

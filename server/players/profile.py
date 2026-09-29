"""The raw /players answer (≈30 KB, talents included) → the compact profile the page reads.

Shape measured on 2026-09-29 (tests/server/fixtures/v1_players_200.json). Every section is read
defensively: a missing or malformed part becomes empty, never an exception.
"""

from __future__ import annotations

from typing import Any

# Storm League first (what most searches are about), then the rest by how often they're played.
MODE_ORDER = ("sl", "qm", "ud", "ar", "hl", "tl")
ROLE_FIELDS = {
    "Tank": "tank_win_rate",
    "Bruiser": "bruiser_win_rate",
    "Healer": "healer_win_rate",
    "Support": "support_win_rate",
    "Melee Assassin": "melee_assassin_win_rate",
    "Ranged Assassin": "ranged_assassin_win_rate",
}


def _d(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _rows(x: Any) -> list[dict[str, Any]]:
    return [r for r in x if isinstance(r, dict)] if isinstance(x, list) else []


def _int(x: Any) -> int:
    return x if isinstance(x, int) and not isinstance(x, bool) else 0


def _num(x: Any) -> float | None:
    return float(x) if isinstance(x, int | float) and not isinstance(x, bool) else None


def _modes(raw: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for mode in MODE_ORDER:
        m = _d(raw.get(f"{mode}_mmr_data"))
        wins, losses = _int(m.get("win")), _int(m.get("loss"))
        if wins + losses == 0:
            continue
        out.append(
            {
                "mode": mode,
                "mmr": m.get("mmr"),
                "tier": m.get("rank_tier"),
                "wins": wins,
                "losses": losses,
                "win_rate": _num(m.get("win_rate")),
            }
        )
    return out


def _heroes(rows: Any) -> list[dict[str, Any]]:
    out = []
    for r in _rows(rows):
        hero = _d(r.get("hero"))
        if not hero.get("name"):
            continue
        out.append(
            {
                "hero": hero["name"],
                "short_name": hero.get("short_name"),
                "games": _int(r.get("games_played")),
                "wins": _int(r.get("wins")),
                "losses": _int(r.get("losses")),
                "win_rate": _num(r.get("win_rate")),
                "last_played": r.get("game_date"),
            }
        )
    return out


def _maps(rows: Any) -> list[dict[str, Any]]:
    out = []
    for r in _rows(rows):
        game_map = _d(r.get("game_map"))
        if not game_map.get("name"):
            continue
        out.append(
            {
                "map": game_map["name"],
                "games": _int(r.get("games_played")),
                "wins": _int(r.get("wins")),
                "losses": _int(r.get("losses")),
                "win_rate": _num(r.get("win_rate")),
            }
        )
    return out


def _matches(rows: Any) -> list[dict[str, Any]]:
    return [
        {
            "replay_id": r.get("replayID"),
            "date": r.get("game_date"),
            "mode": _d(r.get("game_type")).get("short_name"),
            "map": _d(r.get("game_map")).get("name"),
            "hero": _d(r.get("hero")).get("name"),
            "short_name": _d(r.get("hero")).get("short_name"),
            "win": r.get("winner") == 1,
            "mmr_change": _num(r.get("player_change")),
        }
        for r in _rows(rows)
    ]


def normalize_player(raw: dict[str, Any], *, battletag: str, region: str) -> dict[str, Any]:
    roles = [
        {"role": role, "win_rate": wr}
        for role, field in ROLE_FIELDS.items()
        if (wr := _num(raw.get(field))) is not None
    ]
    return {
        "battletag": battletag,
        "region": region,
        "account_level": raw.get("account_level"),
        "wins": _int(raw.get("wins")),
        "losses": _int(raw.get("losses")),
        "win_rate": _num(raw.get("win_rate")),
        "kda": _num(raw.get("kda")),
        "mvp_rate": _num(raw.get("mvp_rate")),
        "modes": _modes(raw),
        "roles": roles,
        "heroes_most_played": _heroes(raw.get("heroes_three_most_played")),
        "heroes_best": _heroes(raw.get("heroes_three_highest_win_rate")),
        "maps_most_played": _maps(raw.get("maps_three_most_played")),
        "recent_matches": _matches(raw.get("matchData")),
    }

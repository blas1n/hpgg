"""HP match rows → the compact rows the page reads. One shape for both sources.

`full` rows come from /players/matches (stat line, talents, per-game MMR); `basic` rows from
/players/mmr/history carry only hero, map id, result and MMR — their stat fields are None and
`talents` is empty. Shapes recorded 2026-10-01 (tests/server/fixtures/v1_players_matches_200.json,
v1_players_mmr_history_200.json). A malformed row is skipped, never an exception.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# Bump when a row gains, loses or changes a field: cached lists in another format are refreshed
# (served only as stale while HP cannot be asked). 2 = `award`; 3 = HP's `award_id`, named when
# served (server/players/awards.py), so an id learned later reaches cached lists (2026-10-01).
ROWS_VERSION = 3
# HP map ids (GET /maps, 2026-10-01). The MMR history names maps only by id.
HP_MAPS: dict[int, str] = {
    int(k): v for k, v in json.loads((Path(__file__).parent / "hp_maps.json").read_text()).items()
}
TALENT_LEVELS = (
    "level_one",
    "level_four",
    "level_seven",
    "level_ten",
    "level_thirteen",
    "level_sixteen",
    "level_twenty",
)
# our field → HP's field, all integers (None when HP sends none, e.g. healing for a non-healer)
STATS = {
    "level": "level",
    "kills": "kills",
    "deaths": "deaths",
    "assists": "assists",
    "takedowns": "takedowns",
    "hero_damage": "hero_damage",
    "siege_damage": "siege_damage",
    "structure_damage": "structure_damage",
    "healing": "healing",
    "self_healing": "self_healing",
    "damage_taken": "damage_taken",
    "experience": "experience_contribution",
    "time_spent_dead": "time_spent_dead",
    "time_cc": "time_cc_enemy_heroes",
    "merc_camps": "merc_camp_captures",
}


def _d(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _int(x: Any) -> int | None:
    return x if isinstance(x, int) and not isinstance(x, bool) else None


def _num(x: Any) -> float | None:
    return round(float(x), 2) if isinstance(x, int | float) and not isinstance(x, bool) else None


def _win(x: Any) -> bool | None:
    if x in (1, True, "1", "True", "true"):
        return True
    if x in (0, False, "0", "False", "false"):
        return False
    return None


def _base(r: dict[str, Any]) -> dict[str, Any] | None:
    hero = _d(r.get("hero"))
    if not isinstance(r.get("replayID"), int) or not hero.get("name"):
        return None
    return {
        "replay_id": r["replayID"],
        "date": r.get("game_date"),
        "hero": hero["name"],
        "short_name": hero.get("short_name"),
        "win": _win(r.get("winner")),
    }


def full_rows(body: Any) -> list[dict[str, Any]]:
    rows = _d(body).get("data")
    out = []
    for r in rows if isinstance(rows, list) else []:
        base = _base(_d(r))
        if base is None:
            continue
        talents = [_d(r.get(lvl)).get("talent_name") for lvl in TALENT_LEVELS]
        out.append(
            {
                **base,
                "mode": _d(r.get("game_type")).get("short_name"),
                "map": _d(r.get("game_map")).get("name"),
                "role": r.get("role"),
                "mmr": _int(r.get("player_mmr")),
                "mmr_change": _num(r.get("player_change")),
                **{ours: _int(r.get(theirs)) for ours, theirs in STATS.items()},
                "first_to_ten": r.get("first_to_ten") == 1,
                "award_id": None if r.get("match_award") is None else str(r["match_award"]),
                "talents": [t if isinstance(t, str) else None for t in talents],
            }
        )
    return out


def basic_rows(body: Any, mode: str) -> list[dict[str, Any]]:
    rows = _d(body).get("history")
    out = []
    for r in rows if isinstance(rows, list) else []:
        base = _base(_d(r))
        if base is None:
            continue
        out.append(
            {
                **base,
                "mode": mode,
                "map": HP_MAPS.get(r["game_map"]) if isinstance(r.get("game_map"), int) else None,
                "role": _d(r.get("hero")).get("new_role"),
                "mmr": _int(r.get("mmr")),
                "mmr_change": _num(r.get("mmr_change")),
                **dict.fromkeys(STATS),
                "first_to_ten": None,
                "award_id": None,
                "talents": [],
            }
        )
    out.sort(key=lambda m: str(m["date"] or ""), reverse=True)
    return out

"""티어별 승률 (owner 2026-10-13): each hero's Storm League win rate in each league tier.

The hero page draws it as a line from bronze to master. HP `/heroes/stats?league_tier=<t>` per
tier (1 bronze … 6 master; HP has no grandmaster id, so grandmasters are inside master), the
whole world in one call (the regions summed are the same numbers, 2026-10-02), each with its
`groupsize=Solo` twin: the party correction is part of every win rate the site shows (owner
2026-10-02). 12 calls on the Heroes/Stats bucket (210/week, the daily cube takes 168), so the set
is fetched about once a week and again when the patch or its window changes; a failure keeps the
previous file.

Probe on 2.57.0.98348 (2026-10-13): median games a hero, bronze 97, silver 226, gold 325,
platinum 344, diamond 226, master 121; 28 of 91 heroes' rates move with the tier beyond the error
(~4 by chance).

Output (data/latest/sl_tiers.json, served as /latest/sl_tiers.json):
  {patch, since, collected_at, tiers: [1…6], matches: [per tier],
   heroes: {hero: [{games, wins, win_rate, tier_win_rate} | null per tier]}}
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from collector.party import apply_party_correction

TIERS: tuple[int, ...] = (1, 2, 3, 4, 5, 6)
REFRESH = timedelta(days=6)


def _at(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def due(path: Path, *, patch: str, since: str | None, collected_at: str) -> bool:
    """Fetch when there is no set yet, it is for another patch or window, or it is a week old."""
    try:
        old = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return True
    if old.get("patch") != patch or old.get("since") != since:
        return True
    return _at(collected_at) - _at(str(old.get("collected_at"))) >= REFRESH


def tiers_file(
    snaps: dict[int, dict[str, Any]],
    solos: dict[int, dict[str, Any]],
    *,
    patch: str,
    since: str | None,
    collected_at: str,
) -> dict[str, Any]:
    """Each tier's view corrected by its solo twin; the whole-map row of each hero per tier."""
    rows: dict[int, dict[str, dict[str, Any]]] = {}
    for t in TIERS:
        corrected = apply_party_correction(snaps[t], solos[t])
        rows[t] = {r["hero"]: r for r in corrected["rows"] if r.get("map") == "all"}
    heroes = sorted({h for by_hero in rows.values() for h in by_hero})
    return {
        "patch": patch,
        "since": since,
        "collected_at": collected_at,
        "tiers": list(TIERS),
        "matches": [snaps[t].get("matches") for t in TIERS],
        "heroes": {
            h: [
                {
                    "games": r["games"],
                    "wins": r["wins"],
                    "win_rate": round(float(r["win_rate"]), 4),
                    "tier_win_rate": round(float(r["tier_win_rate"]), 4),
                }
                if (r := rows[t].get(h))
                else None
                for t in TIERS
            ]
            for h in heroes
        },
    }

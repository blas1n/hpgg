"""Party-corrected win rate: the tier formula's win-rate input (#36, owner 2026-09-29).

Premade players win more, so heroes popular in stacks look stronger than they are for a solo
player. HP `/heroes/stats?groupsize=Solo` gives each hero's record in games where that hero's
player queued alone. Solo players lose to stacks, so the pooled solo rate sits under 50 %; each
hero's solo rate is re-centred by that gap, and the hero's win rate moves toward it by
n_solo / (n_solo + k) — a thin solo sample moves it little. The shown win rate is unchanged;
only `tier_win_rate` (read by the web formula) and the snapshot's `party` block are added.
"""

from __future__ import annotations

import copy
from typing import Any

PARTY_K = 1000


def _pool(rows: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], int, float]:
    """Solo rows by hero (with games), their games, and the pooled solo win rate (%)."""
    by_hero = {r["hero"]: r for r in rows if r.get("games")}
    games = sum(r["games"] for r in by_hero.values())
    pooled = sum(r["wins"] for r in by_hero.values()) / games * 100 if games else 50.0
    return by_hero, games, pooled


def apply_party_correction(
    snap: dict[str, Any], solo: dict[str, Any], k: int = PARTY_K
) -> dict[str, Any]:
    """A copy of `snap` whose rows all carry `tier_win_rate`, plus `party` = {k, solo_pooled,
    solo_games} of the whole view. `solo` is the same view fetched with groupsize=Solo. Each
    map is corrected by its own solo rows and pooled rate (owner 2026-10-02: the correction is
    part of the formula, so every view has it); a hero or map with no solo games keeps its win
    rate."""
    if solo.get("patch") != snap.get("patch"):
        raise ValueError(f"solo data is for patch {solo.get('patch')}, not {snap.get('patch')}")
    by_map: dict[str, list[dict[str, Any]]] = {}
    for r in solo.get("rows", []):
        by_map.setdefault(str(r.get("map")), []).append(r)
    pools = {m: _pool(rows) for m, rows in by_map.items()}
    _, solo_games, pooled_all = pools.get("all", ({}, 0, 50.0))
    if not solo_games:
        raise ValueError("solo data has no games")

    out = copy.deepcopy(snap)
    for row in out.get("rows", []):
        wr = float(row["win_rate"])
        solo_rows, _, pooled = pools.get(str(row.get("map")), ({}, 0, 50.0))
        s = solo_rows.get(row["hero"])
        if s is None:
            row["tier_win_rate"] = wr
            continue
        n = s["games"]
        centred = s["wins"] / n * 100 - (pooled - 50)
        row["tier_win_rate"] = round(wr + (centred - wr) * n / (n + k), 4)
    out["party"] = {"k": k, "solo_pooled": round(pooled_all, 4), "solo_games": solo_games}
    return out

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


def _all_rows(snap: dict[str, Any]) -> list[dict[str, Any]]:
    return [r for r in snap.get("rows", []) if r.get("map") == "all"]


def apply_party_correction(
    snap: dict[str, Any], solo: dict[str, Any], k: int = PARTY_K
) -> dict[str, Any]:
    """A copy of `snap` whose `map="all"` rows carry `tier_win_rate`, plus `party` = {k,
    solo_pooled, solo_games}. `solo` is the same view's snapshot fetched with groupsize=Solo."""
    if solo.get("patch") != snap.get("patch"):
        raise ValueError(f"solo data is for patch {solo.get('patch')}, not {snap.get('patch')}")
    solo_rows = {r["hero"]: r for r in _all_rows(solo) if r.get("games")}
    solo_games = sum(r["games"] for r in solo_rows.values())
    if not solo_games:
        raise ValueError("solo data has no games")
    pooled = sum(r["wins"] for r in solo_rows.values()) / solo_games * 100
    shift = pooled - 50

    out = copy.deepcopy(snap)
    for row in _all_rows(out):
        s = solo_rows.get(row["hero"])
        wr = float(row["win_rate"])
        if s is None:
            row["tier_win_rate"] = wr
            continue
        n = s["games"]
        centred = s["wins"] / n * 100 - shift
        row["tier_win_rate"] = round(wr + (centred - wr) * n / (n + k), 4)
    out["party"] = {"k": k, "solo_pooled": round(pooled, 4), "solo_games": solo_games}
    return out

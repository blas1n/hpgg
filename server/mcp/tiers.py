"""The site's tier table (web/src/formula.ts, web/src/lib/tier.ts) recomputed for the owner MCP.

score = pick × (WRs − 50) × 3 + ban_rate × 1, WRs = 50 + (WR − 50) × n / (n + 500), WR the
party-corrected rate where the row has one; heroes under `min_games_for_tier` are listed but not
tiered. The ranked heroes are cut S 6% / A 24% / B 54% / C 82% / D 94% / F rest. Both copies of the
formula are checked against tests/fixtures/tier_formula_golden.json, written by the TypeScript one.

The view is chosen like the site's: the snapshot file for mode + bracket + region on the site's
reference patch (meta.reference_patch: the previous patch while the current one is thin).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

TIERS = ("S", "A", "B", "C", "D", "F")
CUTS = (0.06, 0.24, 0.54, 0.82, 0.94, 1.01)
W_PICK, W_BAN, K = 3, 1, 500
FORMULA = (
    "score = pick × (WRs − 50) × 3 + ban_rate × 1; WRs = 50 + (WR − 50) × games / (games + 500), "
    "WR party-corrected where available; heroes under min_games are not tiered; ranked heroes cut "
    "S 6% / A 24% / B 54% / C 82% / D 94% / F rest (cumulative)"
)


def shrink(win_rate: float, games: float) -> float:
    if games <= 0:
        return 50.0
    return 50 + (win_rate - 50) * games / (games + K)


def score(row: dict[str, Any]) -> float:
    wr = row.get("tier_win_rate")
    wrs = shrink(float(wr if wr is not None else row["win_rate"]), float(row["games"]))
    return float(row["pick"]) * (wrs - 50) * W_PICK + float(row["ban_rate"]) * W_BAN


def boundaries(n: int) -> list[int]:
    out, prev = [], 0
    for c in CUTS:
        b = min(n, max(math.floor(c * n), prev + 1))
        out.append(b)
        prev = b
    return out


@dataclass(frozen=True)
class Ranked:
    hero: str
    tier: str
    rank: int
    score: float
    row: dict[str, Any]


@dataclass(frozen=True)
class TierResult:
    ranked: list[Ranked]
    grey: list[str]


def compute_tiers(rows: list[dict[str, Any]], min_games: int) -> TierResult:
    grey = [r["hero"] for r in rows if r["games"] < min_games]
    scored = sorted(
        ((r, score(r)) for r in rows if r["games"] >= min_games),
        key=lambda x: (-x[1], x[0]["hero"]),
    )
    bounds = boundaries(len(scored))
    ranked = []
    for i, (r, s) in enumerate(scored):
        tier = next((TIERS[t] for t, b in enumerate(bounds) if i < b), "F")
        ranked.append(Ranked(r["hero"], tier, i + 1, s, r))
    return TierResult(ranked, grey)


def snapshot_key(mode: str, bracket: str, region: str) -> str:
    if mode == "ar":
        return "ar"
    view = f"sl_{bracket}" if mode == "sl" and bracket != "all" else mode
    return view if region == "all" else f"{view}_{region}"


def _read(path: Path) -> dict[str, Any]:
    try:
        data: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def load_view(data_dir: Path, key: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """(meta, snapshot) on the site's reference patch; empty dicts when missing."""
    meta = _read(data_dir / "latest" / "meta.json")
    previous = meta.get("previous_patch")
    on_previous = bool(previous) and meta.get("reference_patch") == previous
    snap = _read(data_dir / ("previous" if on_previous else "latest") / f"{key}.json")
    return meta, snap

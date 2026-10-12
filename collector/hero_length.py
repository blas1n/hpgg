"""게임 시간대별 승률 (roadmap stage 2): each hero's Storm League record by game length.

The daily replay sample (collector/replay_sample.py) keeps every game's length; its records are
archived day by day on the snapshots branch. Each run counts them all again, from the archive the
workflow checks out plus the day's own folder, over the games of the patch's window (a settled
balance hotfix restarts the count, owner 2026-10-07; collector.snapshot.balance_window). Nothing
accumulates between runs, so a game is never counted twice or missed.

Bands are the weekly report's (collector/replay_insights.py): up to 15 minutes, 15 to 20, over 20.
A hero `lean`s early or late only when its short-game and long-game rates differ beyond the error
(two-proportion z ≥ 1.96, each band at least `min_games`); on 6,000 games of 2.57.0, 15 of 88
heroes did against ~4 by chance (2026-10-12). Quick Match is left out: ~170 games a day leave most
heroes under 20 games a band.

Output (data/latest/sl_length.json, served as /latest/sl_length.json):
  {patch, since, collected_at, games, bands: {short, mid, long},
   heroes: {hero: {short: {games, wins}, mid: …, long: …, lean: "early" | "late" | null}}}
"""

from __future__ import annotations

import gzip
import json
import math
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from collector.replay_insights import LONG_S, SHORT_S
from collector.snapshot import patch_line

BANDS = ("short", "mid", "long")
Z = 1.96


def band_of(length: int) -> str:
    return "short" if length <= SHORT_S else "long" if length > LONG_S else "mid"


def _version_key(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in v.split("."))


def _in_window(version: str, patch: str, since: str | None) -> bool:
    if patch_line(version) != patch:
        return False
    if since is None or patch_line(since) != patch:
        return True
    return _version_key(version) >= _version_key(since)


def _lean(short: dict[str, int], long: dict[str, int], min_games: int) -> str | None:
    n1, n2 = short["games"], long["games"]
    if n1 < min_games or n2 < min_games:
        return None
    w1, w2 = short["wins"], long["wins"]
    p = (w1 + w2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    if se == 0:
        return None
    z = (w2 / n2 - w1 / n1) / se
    return "late" if z >= Z else "early" if z <= -Z else None


def length_rates(
    games: Iterable[dict[str, Any]],
    *,
    patch: str,
    since: str | None,
    collected_at: str | None = None,
    min_games: int = 30,
) -> dict[str, Any]:
    seen: set[int] = set()
    bands = dict.fromkeys(BANDS, 0)
    heroes: dict[str, dict[str, Any]] = {}
    for g in games:
        if g["id"] in seen or not _in_window(str(g.get("version") or ""), patch, since):
            continue
        seen.add(g["id"])
        b = band_of(int(g["length"]))
        bands[b] += 1
        for p in g["players"]:
            h = heroes.setdefault(p["hero"], {k: {"games": 0, "wins": 0} for k in BANDS})
            h[b]["games"] += 1
            h[b]["wins"] += 1 if p["win"] else 0
    for h in heroes.values():
        h["lean"] = _lean(h["short"], h["long"], min_games)
    return {
        "patch": patch,
        "since": since if since and patch_line(since) == patch else None,
        "collected_at": collected_at,
        "games": len(seen),
        "bands": bands,
        "heroes": dict(sorted(heroes.items())),
    }


def load_archive(roots: Iterable[Path], kind: str = "sl") -> list[dict[str, Any]]:
    """Every day folder's `replays_<kind>.jsonl.gz` under each root, each game once."""
    out: dict[int, dict[str, Any]] = {}
    for root in roots:
        for f in sorted(root.glob(f"*/replays_{kind}.jsonl.gz")):
            with gzip.open(f, "rt", encoding="utf-8") as fh:
                for line in fh:
                    if line.strip():
                        g = json.loads(line)
                        out.setdefault(g["id"], g)
    return list(out.values())

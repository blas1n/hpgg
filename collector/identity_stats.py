"""영웅별 주요 스탯 (owner 2026-10-12): what sets a hero apart, beyond the card's stat line.

Overwatch shows each hero's own numbers (Ana's healing blocked, Genji's damage reflected). Heroes
Profile sends the same score line for every hero, so a hero's identity is read from it instead:
the stats on which the hero stands far above all heroes.

Each run counts the archived replay records again (collector/replay_sample.py; the Storm League
days the workflow checks out, plus the day's own folder) over the last `days` days. Nothing
accumulates between runs, like 게임 시간대별 승률 (collector/hero_length.py).

- Per minute, so a hero seen in long games does not look big: each player's value / game minutes,
  then the hero's mean set against all players' mean, in all players' standard deviations (z).
- Picked: z ≥ `min_z` and the hero's mean ≥ `min_ratio` × all heroes' mean (owner: below 1.5×
  it is no identity), up to `top`, strongest first. A hero with none is left out and the card
  shows nothing (Cassia: blinds are no score value in the game).
- Candidates (CANDIDATES): only what the card's numbers do not show. Not the card's own line, nor
  vengeance, on fire, escapes, merc / structure / summon damage (owner 2026-10-12/13), nor
  time_cc_enemy_heroes (0 in every record from Heroes Profile, 2026-10-12).
- `avg` is the hero's mean per game: the match list carries no game length, so the card compares
  a game's value with it.


Output (data/identity_stats.json, served as /identity_stats.json):
  {collected_at, since, games, heroes: {hero: {games, stats: [{stat, avg, ratio}]}}}
  `stat` is the match row's field (server/players/match_rows.py STATS).
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Any

# match row field (server/players/match_rows.py) → Heroes Profile score field. Owner 10-13: what
# the card's numbers do not show — crowd control time, self healing, shields, clutch heals. Not on
# fire or escapes (luck more than the hero), nor merc / structure / summon damage (in siege damage).
CANDIDATES: dict[str, str] = {
    "stuns": "stunning_enemies",
    "roots": "rooting_enemies",
    "silences": "silencing_enemies",
    "self_healing": "self_healing",
    "shields": "protection_allies",
    "clutch_heals": "clutch_heals",
}


def _f(x: Any) -> float:
    return float(x) if isinstance(x, int | float) and not isinstance(x, bool) else 0.0


def identity_stats(
    games: Iterable[dict[str, Any]],
    *,
    collected_at: str,
    days: int = 28,
    min_games: int = 100,
    top: int = 3,
    min_z: float = 0.3,
    min_ratio: float = 1.5,
) -> dict[str, Any]:
    since = (
        (datetime.fromisoformat(collected_at.replace("Z", "+00:00")) - timedelta(days=days))
        .date()
        .isoformat()
    )
    seen: set[Any] = set()
    n = 0
    # per stat: all players' sums for the mean and deviation; per hero: per-minute and per-game sums
    total: dict[str, list[float]] = {s: [0.0, 0.0] for s in CANDIDATES}  # Σv, Σv²
    players = 0
    hero_n: dict[str, int] = defaultdict(int)
    hero_min: dict[str, dict[str, float]] = defaultdict(lambda: dict.fromkeys(CANDIDATES, 0.0))
    hero_game: dict[str, dict[str, float]] = defaultdict(lambda: dict.fromkeys(CANDIDATES, 0.0))
    for g in games:
        ps, length, date = g.get("players"), g.get("length"), str(g.get("date") or "")
        if g.get("id") in seen or not isinstance(ps, list) or not _f(length) or date[:10] < since:
            continue
        seen.add(g["id"])
        n += 1
        minutes = max(_f(length) / 60, 1.0)
        for p in ps:
            hero, score = p.get("hero"), p.get("score")
            if not hero or not isinstance(score, dict):
                continue
            players += 1
            hero_n[hero] += 1
            for s, field in CANDIDATES.items():
                v = _f(score.get(field))
                total[s][0] += v / minutes
                total[s][1] += (v / minutes) ** 2
                hero_min[hero][s] += v / minutes
                hero_game[hero][s] += v
    mean = {s: (t[0] / players if players else 0.0) for s, t in total.items()}
    sd = {
        s: math.sqrt(max(t[1] / players - mean[s] ** 2, 0.0)) if players else 0.0
        for s, t in total.items()
    }
    heroes: dict[str, Any] = {}
    for hero in sorted(hero_n):
        k = hero_n[hero]
        if k < min_games:
            continue
        ranked = []
        for s in CANDIDATES:
            m = hero_min[hero][s] / k
            if not mean[s] or not sd[s]:
                continue
            z, ratio = (m - mean[s]) / sd[s], m / mean[s]
            if z >= min_z and ratio >= min_ratio:
                ranked.append((z, s, ratio))
        stats = []
        for _z, s, ratio in sorted(ranked, reverse=True):
            stats.append(
                {"stat": s, "avg": round(hero_game[hero][s] / k, 2), "ratio": round(ratio, 2)}
            )
            if len(stats) == top:
                break
        if stats:
            heroes[hero] = {"games": k, "stats": stats}
    return {"collected_at": collected_at, "since": since, "games": n, "heroes": heroes}

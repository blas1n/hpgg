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
  it is no identity), up to `top`, strongest first; one of escapes / teamfight escapes. A hero with
  none is left out and the card shows nothing (Cassia: blinds are no score value in the game).
- Candidates leave out what the card already shows (K/D/A, hero and siege damage, healing, damage
  taken, experience, and their teamfight twins), vengeance (owner: says nothing of the hero) and
  time_cc_enemy_heroes (0 in every record from Heroes Profile, 2026-10-12).
- `avg` is the hero's mean per game: the match list carries no game length, so the card compares
  a game's value with it.

On 6,835 games (2026-10-07..11) 89 of 91 heroes get one to three (Cassia and Falstad none).

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

# match row field (server/players/match_rows.py) → Heroes Profile score field
CANDIDATES: dict[str, str] = {
    "self_healing": "self_healing",
    "merc_camps": "merc_camp_captures",
    "structure_damage": "structure_damage",
    "creep_damage": "creep_damage",
    "summon_damage": "summon_damage",
    "shields": "protection_allies",
    "clutch_heals": "clutch_heals",
    "stuns": "stunning_enemies",
    "roots": "rooting_enemies",
    "silences": "silencing_enemies",
    "escapes": "escapes",
    "teamfight_escapes": "teamfight_escapes",
    "multikill": "multikill",
    "towers": "watch_tower_captures",
    "regen_globes": "regen_globes",
    "time_on_fire": "time_on_fire",
    "town_kills": "town_kills",
}
# near twins: a hero shows one of each
GROUPS = {"teamfight_escapes": "escapes"}


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
        stats, used = [], set()
        for _z, s, ratio in sorted(ranked, reverse=True):
            if GROUPS.get(s, s) in used:
                continue
            used.add(GROUPS.get(s, s))
            stats.append(
                {"stat": s, "avg": round(hero_game[hero][s] / k, 2), "ratio": round(ratio, 2)}
            )
            if len(stats) == top:
                break
        if stats:
            heroes[hero] = {"games": k, "stats": stats}
    return {"collected_at": collected_at, "since": since, "games": n, "heroes": heroes}

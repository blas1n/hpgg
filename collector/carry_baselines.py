"""몇인분's yardstick (owner 2026-10-06): each hero's usual output per minute, from the replays.

The page judges a game's 몇인분 against what the same hero usually does, not its role (a bruiser
played as a tank, a melee assassin as a bruiser; a bruiser's job includes soaking experience). Per
minute, so a long game does not look like a big one. Every daily run adds its sampled games
(collector/replay_sample.py, Storm League and Quick Match) to running sums kept in the file, the
older days multiplied by `decay` first, so the recent week or two weighs most. A hero with fewer
than `min_games` (weighted) is left out of `heroes` and the page uses its role's.

Output (data/carry_baselines.json, published with the site as /carry_baselines.json):
  {updated, heroes: {hero: {games, per_min: {stat: v}}}, roles: {role: {...}}, all: {stat: v},
   acc: <the running sums>}
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

STATS = ("td", "dmg", "siege", "xp", "sus", "cc", "prot", "map", "dead")


def _values(score: dict[str, Any]) -> dict[str, float]:
    def g(k: str) -> float:
        return float(score.get(k) or 0)

    return {
        "td": g("takedowns"),
        "dmg": g("hero_damage"),
        "siege": g("siege_damage"),
        "xp": g("experience_contribution"),
        "sus": g("healing") + g("damage_taken"),
        "cc": g("stunning_enemies") + g("rooting_enemies") + g("silencing_enemies"),
        "prot": g("protection_allies"),
        "map": g("merc_camp_captures") + g("watch_tower_captures"),
        "dead": g("time_spent_dead"),
    }


def _add(acc: dict[str, Any], key: str, per_min: dict[str, float]) -> None:
    a = acc.setdefault(key, {"w": 0.0, "sum": dict.fromkeys(STATS, 0.0)})
    a["w"] += 1.0
    for s in STATS:
        a["sum"][s] += per_min[s]


def _means(a: dict[str, Any]) -> dict[str, float]:
    return {s: a["sum"][s] / a["w"] for s in STATS} if a["w"] else dict.fromkeys(STATS, 0.0)


def update_baselines(
    path: Path,
    games: list[dict[str, Any]],
    *,
    roles: dict[str, str],
    day: str,
    min_games: float = 100,
    decay: float = 0.85,
) -> None:
    old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    acc: dict[str, dict[str, Any]] = old.get("acc") or {"heroes": {}, "roles": {}, "all": {}}
    if old.get("updated") != day:  # a new day: what came before weighs less
        for group in acc.values():
            for a in group.values():
                a["w"] *= decay
                a["sum"] = {s: v * decay for s, v in a["sum"].items()}
    for g in games:
        minutes = max(float(g.get("length") or 0) / 60, 1.0)
        for p in g.get("players") or []:
            hero = p.get("hero")
            if not hero:
                continue
            per_min = {s: v / minutes for s, v in _values(p.get("score") or {}).items()}
            _add(acc["heroes"], hero, per_min)
            if hero in roles:
                _add(acc["roles"], roles[hero], per_min)
            _add(acc["all"], "all", per_min)
    out = {
        "updated": day,
        "decay": decay,
        "heroes": {
            h: {"games": round(a["w"], 2), "per_min": _means(a)}
            for h, a in sorted(acc["heroes"].items())
            if a["w"] >= min_games
        },
        "roles": {
            r: {"games": round(a["w"], 2), "per_min": _means(a)}
            for r, a in sorted(acc["roles"].items())
        },
        "all": _means(acc["all"]["all"]) if "all" in acc["all"] else dict.fromkeys(STATS, 0.0),
        "acc": acc,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)

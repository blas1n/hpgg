"""The weekly report's analysis on games (owner 2026-10-06).

A report follows one central pick through the whole game. Each function reads per-game records
(collector/replay_sample.py) and answers one question with its sample:

- draft_profile: how often it is banned (and with the very first ban), how often picked, in
  which pick round, and how it does when picked;
- game_shape: games with it against games without: length, its team's level lead at 10 minutes,
  and its record by game length;
- answered_by: what the other team drafts after it is picked, how much more often than in other
  games (lift), and how those answers do;
- build_split: for one answer, how each talent at a level does against it, in high- and low-MMR
  games (a counter is a build in someone's hands, not a hero);
- win_loss_contrast: in games of the answer against it, what differs between the answer's wins
  and losses — the centre's deaths, the answer's teamfight damage…

Pure but for load_week. Percentages are 0–100; a rate on no games is None.
"""

from __future__ import annotations

import gzip
import json
import statistics
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

Game = dict[str, Any]

SHORT_S, LONG_S = 15 * 60, 20 * 60
CENTRE_STATS = (
    "deaths",
    "outnumbered_deaths",
    "time_spent_dead",
    "hero_damage",
    "teamfight_hero_damage",
    "damage_taken",
    "escapes",
)
ANSWER_STATS = (
    "kills",
    "deaths",
    "hero_damage",
    "teamfight_hero_damage",
    "stunning_enemies",
    "rooting_enemies",
    "silencing_enemies",
    "outnumbered_deaths",
)


def _rate(n: int, d: int) -> float | None:
    return n / d * 100 if d else None


def _team_of(g: Game, hero: str) -> int | None:
    return next((p["team"] for p in g["players"] if p["hero"] == hero), None)


def _player(g: Game, hero: str) -> dict[str, Any] | None:
    return next((p for p in g["players"] if p["hero"] == hero), None)


def _picks(g: Game) -> list[list[Any]]:
    return [d for d in g.get("draft") or [] if d[0] == "p"]


def _mmr(g: Game) -> float | None:
    vals = [p["mmr"] for p in g["players"] if p.get("mmr")]
    return statistics.fmean(vals) if vals else None


def draft_profile(games: list[Game], hero: str) -> dict[str, Any]:
    n = len(games)
    banned = [g for g in games if any(d[0] == "b" and d[2] == hero for d in g.get("draft") or [])]
    first_ban = [g for g in banned if (g.get("draft") or [[None, None, None]])[0][2] == hero]
    picked = [g for g in games if _team_of(g, hero) is not None]
    rounds: Counter[str] = Counter()
    for g in picked:
        order = [d[2] for d in _picks(g)]
        if hero in order:
            i = order.index(hero) + 1
            rounds["first" if i == 1 else "last" if i >= 9 else "middle"] += 1
    wins = sum(1 for g in picked if g["winner"] == _team_of(g, hero))
    return {
        "games": n,
        "ban_rate": _rate(len(banned), n),
        "first_ban_rate": _rate(len(first_ban), n),
        "pick_rate": _rate(len(picked), n),
        "picked": len(picked),
        "win_rate": _rate(wins, len(picked)),
        "pick_round": {k: rounds[k] for k in ("first", "middle", "last")},
    }


def _lead_at(g: Game, team: int, minute: int) -> int | None:
    lv = g.get("level") or [[], []]
    if len(lv[0]) < minute or len(lv[1]) < minute:
        return None
    return int(lv[team][minute - 1] - lv[1 - team][minute - 1])


def _band(length: int) -> str:
    return "short" if length <= SHORT_S else "long" if length > LONG_S else "mid"


def game_shape(games: list[Game], hero: str) -> dict[str, Any]:
    def shape(gs: list[Game], with_hero: bool) -> dict[str, Any]:
        out: dict[str, Any] = {
            "games": len(gs),
            "length_min": statistics.fmean(g["length"] for g in gs) / 60 if gs else None,
        }
        if with_hero:
            leads = [v for g in gs if (v := _lead_at(g, _team_of(g, hero) or 0, 10)) is not None]
            out["lead_at_10"] = statistics.fmean(leads) if leads else None
            by: dict[str, dict[str, Any]] = {}
            for band in ("short", "mid", "long"):
                b = [g for g in gs if _band(g["length"]) == band]
                w = sum(1 for g in b if g["winner"] == _team_of(g, hero))
                by[band] = {"games": len(b), "win_rate": _rate(w, len(b))}
            out["by_length"] = by
        return out

    with_ = [g for g in games if _team_of(g, hero) is not None]
    without = [g for g in games if _team_of(g, hero) is None]
    return {"with": shape(with_, True), "without": shape(without, False)}


def answered_by(games: list[Game], hero: str, *, min_games: int = 30) -> list[dict[str, Any]]:
    """Heroes the other team picks after `hero`, most lifted first."""
    with_ = [g for g in games if _team_of(g, hero) is not None]
    without = [g for g in games if _team_of(g, hero) is None]
    after: Counter[str] = Counter()
    wins: Counter[str] = Counter()
    for g in with_:
        team = _team_of(g, hero)
        order = _picks(g)
        names = [d[2] for d in order]
        if hero not in names:
            continue
        for d in order[names.index(hero) + 1 :]:
            if d[1] is not None and d[1] != team and d[2]:
                after[d[2]] += 1
                wins[d[2]] += int(g["winner"] == d[1])
    base: Counter[str] = Counter()
    for g in without:
        for p in g["players"]:
            base[p["hero"]] += 1
    rows = []
    for h, k in after.items():
        if k < min_games:
            continue
        share = _rate(k, len(with_)) or 0.0
        baseline = _rate(base[h], len(without))
        rows.append(
            {
                "hero": h,
                "games": k,
                "share": share,
                "baseline_share": baseline,
                "lift": share / baseline if baseline else None,
                "win_rate": _rate(wins[h], k),
            }
        )
    return sorted(rows, key=lambda r: (-(r["lift"] or 0), -r["games"]))


def _versus(games: list[Game], centre: str, answer: str) -> list[Game]:
    out = []
    for g in games:
        tc, ta = _team_of(g, centre), _team_of(g, answer)
        if tc is not None and ta is not None and tc != ta:
            out.append(g)
    return out


LEVELS = (1, 4, 7, 10, 13, 16, 20)


def build_split(games: list[Game], centre: str, answer: str, *, level: int) -> dict[str, Any]:
    """The answer's record against `centre` by its talent at `level`, split at the median game
    MMR of these games."""
    vs = _versus(games, centre, answer)
    idx = LEVELS.index(level)
    mmrs = [m for g in vs if (m := _mmr(g)) is not None]
    cut = statistics.median(mmrs) if mmrs else None
    acc: dict[str, dict[str, list[int]]] = defaultdict(
        lambda: {"all": [0, 0], "high": [0, 0], "low": [0, 0]}
    )
    total_w = 0
    for g in vs:
        p = _player(g, answer)
        talents = (p or {}).get("talents") or []
        t = talents[idx] if idx < len(talents) else None
        won = int(g["winner"] == _team_of(g, answer))
        total_w += won
        if not t:
            continue
        m = _mmr(g)
        band = "high" if cut is not None and m is not None and m >= cut else "low"
        for k in ("all", band):
            acc[t][k][0] += 1
            acc[t][k][1] += won

    def cell(c: list[int]) -> dict[str, Any]:
        return {"games": c[0], "win_rate": _rate(c[1], c[0])}

    rows = [
        {
            "talent": t,
            "games": a["all"][0],
            "win_rate": _rate(a["all"][1], a["all"][0]),
            "high_mmr": cell(a["high"]),
            "low_mmr": cell(a["low"]),
        }
        for t, a in acc.items()
    ]
    return {
        "games": len(vs),
        "win_rate": _rate(total_w, len(vs)),
        "mmr_cut": cut,
        "talents": sorted(rows, key=lambda r: -r["games"]),
    }


def win_loss_contrast(games: list[Game], centre: str, answer: str) -> dict[str, Any]:
    vs = _versus(games, centre, answer)
    won = [g for g in vs if g["winner"] == _team_of(g, answer)]
    lost = [g for g in vs if g["winner"] != _team_of(g, answer)]

    def mean(gs: list[Game], hero: str, stat: str) -> float | None:
        vals = [
            float(v)
            for g in gs
            if (p := _player(g, hero)) and (v := (p.get("score") or {}).get(stat)) is not None
        ]
        return statistics.fmean(vals) if vals else None

    def side(hero: str, stats: tuple[str, ...]) -> dict[str, dict[str, float | None]]:
        return {
            s: {"when_won": mean(won, hero, s), "when_lost": mean(lost, hero, s)} for s in stats
        }

    return {
        "wins": len(won),
        "losses": len(lost),
        "length_min": {
            "when_won": statistics.fmean(g["length"] for g in won) / 60 if won else None,
            "when_lost": statistics.fmean(g["length"] for g in lost) / 60 if lost else None,
        },
        "centre": side(centre, CENTRE_STATS),
        "answer": side(answer, ANSWER_STATS),
    }


KST = timedelta(hours=9)


def load_week(snapshot_dir: Path, week: str) -> dict[str, list[Game]]:
    """The games played in an ISO week, Monday to Sunday KST (HP's game_date is UTC), from every
    day folder's replays_<sl|qm>.jsonl.gz; a game sampled twice counts once."""
    y, w = week.split("-w")
    monday = datetime.combine(date.fromisocalendar(int(y), int(w), 1), datetime.min.time())
    start, end = monday - KST, monday + timedelta(days=7) - KST
    out: dict[str, list[Game]] = {"sl": [], "qm": []}
    seen: set[tuple[str, int]] = set()
    for kind in out:
        for path in sorted(snapshot_dir.glob(f"*/replays_{kind}.jsonl.gz")):
            with gzip.open(path, "rt", encoding="utf-8") as f:
                for line in f:
                    g = json.loads(line)
                    played = datetime.fromisoformat(str(g.get("date")))
                    if start <= played < end and (kind, g["id"]) not in seen:
                        seen.add((kind, g["id"]))
                        out[kind].append(g)
        out[kind].sort(key=lambda g: g["id"])
    return out


def _build_key(version: str) -> tuple[int, ...]:
    return tuple(int(x) for x in version.split(".") if x.isdigit())


def split_by_build(games: list[Game], build: str) -> tuple[list[Game], list[Game]]:
    """Games before `build` and from it on (a hotfix in the middle of a week)."""
    cut = _build_key(build)
    old = [g for g in games if _build_key(str(g.get("version") or "0")) < cut]
    new = [g for g in games if _build_key(str(g.get("version") or "0")) >= cut]
    return old, new


def talent_picks(games: list[Game], hero: str) -> dict[str, list[dict[str, Any]]]:
    """The hero's own talents per level in these games: share of its games and win rate, most
    picked first."""
    played = [(g, p) for g in games if (p := _player(g, hero)) is not None]
    out: dict[str, list[dict[str, Any]]] = {}
    for i, level in enumerate(LEVELS):
        count: Counter[str] = Counter()
        wins: Counter[str] = Counter()
        for g, p in played:
            t = (p.get("talents") or [None] * 7)[i]
            if t:
                count[t] += 1
                wins[t] += int(g["winner"] == p["team"])
        total = sum(count.values())
        if total:
            out[str(level)] = [
                {
                    "talent": t,
                    "games": n,
                    "share": n / total * 100,
                    "win_rate": _rate(wins[t], n),
                }
                for t, n in count.most_common()
            ]
    return out


def ban_rates(games: list[Game]) -> list[dict[str, Any]]:
    """Where the ban slots go: each hero's share of games it is banned in, and banned in the
    first ban phase (the first four bans), most banned first."""
    banned: Counter[str] = Counter()
    first: Counter[str] = Counter()
    for g in games:
        bans = [d for d in g.get("draft") or [] if d[0] == "b"]
        banned.update({d[2] for d in bans if d[2]})
        first.update({d[2] for d in bans[:4] if d[2]})
    n = len(games)
    return [
        {"hero": h, "ban_rate": k / n * 100, "first_phase_rate": first[h] / n * 100}
        for h, k in banned.most_common()
    ]


def by_enemy_trait(games: list[Game], hero: str, stat: str) -> dict[str, Any]:
    """The hero's record against teams with more and less of `stat` (the opposing team's total,
    split at its median over these games, or into some and none when most have none): does a
    team that roots, stuns… beat it more?"""
    rows: list[tuple[float, int]] = []
    for g in games:
        team = _team_of(g, hero)
        if team is None:
            continue
        total = sum(
            float((p.get("score") or {}).get(stat) or 0) for p in g["players"] if p["team"] != team
        )
        rows.append((total, int(g["winner"] == team)))
    if not rows:
        return {
            "cut": None,
            "more": {"games": 0, "win_rate": None},
            "less": {"games": 0, "win_rate": None},
        }
    cut = statistics.median(t for t, _ in rows)
    # a stat most teams lack (roots: only some heroes have one) splits into some and none
    more = [w for t, w in rows if (t > 0 if cut == 0 else t >= cut)]
    less = [w for t, w in rows if (t == 0 if cut == 0 else t < cut)]
    return {
        "cut": cut,
        "more": {"games": len(more), "win_rate": _rate(sum(more), len(more))},
        "less": {"games": len(less), "win_rate": _rate(sum(less), len(less))},
    }


def build_after(games: list[Game], day: str) -> str | None:
    """The build a hotfix of `day` shipped in: the newest build whose first game is on or after
    that day (UTC), if any."""
    first: dict[str, str] = {}
    for g in games:
        v, d = str(g.get("version") or ""), str(g.get("date") or "")
        if v and d and (v not in first or d < first[v]):
            first[v] = d
    later = [v for v, d in first.items() if d[:10] >= day]
    return max(later, key=_build_key) if later else None

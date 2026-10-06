"""The weekly report's evidence, Storm League (owner 2026-10-05).

usage: uv run python tools/weekly_evidence.py 2026-w40 [--data-dir data]
       → data/weekly/<week>.evidence.json, and a readable summary on stdout
The collector reads it too: on the Monday an issue is written, it fetches the talents of the
heroes the evidence cites (collector/talent_details.py).

The analysis prose may state only what this file holds, each fact with its number and sample:
- the meta's centre: the hero most present (pick + ban) this week;
- its specs (data/hero_specs.json) and average stats (data/latest/sl_averages.json), ranked in its
  role and among all heroes;
- who holds it down and who it crushes (data/matchups, Storm League, patch to date): a gap is a
  finding on 100+ games outside the 95 % margin, otherwise a hunch and said as one;
- this week's risers and fallers by the site's tier formula, each with its matchup against the
  centre and this patch's own change to it (buff / nerf / mixed from the notes, hotfix without one).
Quick Match is left out: players pick before the map and the teams are known, so there is no counter
pick to explain (owner 2026-10-05).

The tier score mirrors web/src/formula.ts (score = pick × (shrunk WR − 50) × 3 + ban, WR shrunk by
n / (n + 500), floor from meta.min_games_for_tier); tests/test_weekly_evidence.py pins the ranks.
"""

from __future__ import annotations

import json
import math
import statistics
from pathlib import Path
from typing import Any

MODE = "sl"
K = 500
W_PICK, W_BAN = 3, 1
MIN_MATCHUP_GAMES = 100
MOVERS = 8
MATCHUPS_SHOWN = 10
STAT_KEYS = ("hero_damage", "healing", "damage_taken", "deaths", "siege_damage")


def significant(*, delta: float, base: float, games: int) -> bool:
    """A matchup gap (percentage points) worth stating: 100+ games and outside the 95 % margin of
    a win rate of `base` % on that many games."""
    if games < MIN_MATCHUP_GAMES:
        return False
    p = min(max(base / 100, 0.01), 0.99)
    return abs(delta) > 1.96 * math.sqrt(p * (1 - p) / games) * 100


def _score(r: dict[str, Any]) -> float:
    wr = float(r.get("tier_win_rate") or r["win_rate"])
    g = int(r["games"])
    wrs = 50 + (wr - 50) * g / (g + K)
    return float(float(r["pick"]) * (wrs - 50) * W_PICK + float(r.get("ban_rate") or 0) * W_BAN)


def _ranks(rows: list[dict[str, Any]], floor: int) -> dict[str, int]:
    ranked = sorted(
        (r for r in rows if r["map"] == "all" and r["games"] >= floor),
        key=lambda r: (-_score(r), r["hero"]),
    )
    return {r["hero"]: i + 1 for i, r in enumerate(ranked)}


def _load(p: Path) -> Any:
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def _rank(values: dict[str, float], hero: str, among: list[str]) -> dict[str, Any] | None:
    pool = sorted((h for h in among if h in values), key=lambda h: -values[h])
    return {"rank": pool.index(hero) + 1, "of": len(pool)} if hero in pool else None


def build_evidence(data: Path, week: str) -> dict[str, Any]:
    issue = _load(data / "weekly" / f"{week}.json")
    view = issue["views"][MODE]
    floor = int((_load(data / "latest" / "meta.json") or {}).get("min_games_for_tier") or 50)
    table = _load(data / "heroes_ko.json")["heroes"]
    by_name = {h["name"]: h for h in table}
    window = {
        r["hero"]: r for r in view["window"]["rows"] if r["map"] == "all" and r["hero"] in by_name
    }
    base_rows = (view.get("baseline") or {}).get("rows") or []
    baseline = {r["hero"]: r for r in base_rows if r["map"] == "all" and r["hero"] in by_name}
    rank_now, rank_before = (
        _ranks(list(window.values()), floor),
        _ranks(list(baseline.values()), floor),
    )

    centre_name = max(
        window.values(),
        key=lambda r: (float(r["pick"]) + float(r.get("ban_rate") or 0), r["games"]),
    )["hero"]
    c = window[centre_name]
    c_info = by_name[centre_name]
    role_of = {h["name"]: h["role"] for h in table}
    same_role = [h["name"] for h in table if h["role"] == c_info["role"]]
    everyone = [h["name"] for h in table]

    specs_all = (_load(data / "hero_specs.json") or {}).get("heroes", {})
    specs_by_name = {h["name"]: specs_all.get(h["slug"]) for h in table if specs_all.get(h["slug"])}
    averages = (_load(data / "latest" / "sl_averages.json") or {}).get("stats", {})
    profile_avgs: dict[str, Any] = {}
    for stat in STAT_KEYS:
        values = {h: float(v) for h, v in (averages.get(stat) or {}).items() if h in by_name}
        if centre_name not in values:
            continue
        role_vals = [values[h] for h in same_role if h in values]
        ra, rr = _rank(values, centre_name, everyone), _rank(values, centre_name, same_role)
        profile_avgs[stat] = {
            "value": values[centre_name],
            "rank_all": ra["rank"] if ra else None,
            "of_all": ra["of"] if ra else None,
            "rank_role": rr["rank"] if rr else None,
            "of_role": rr["of"] if rr else None,
            "role_median": statistics.median(role_vals) if role_vals else None,
            "all_mean": statistics.fmean(values.values()) if values else None,
        }
    lives = {h: float(s["life"]) for h, s in specs_by_name.items() if s.get("life")}

    mu = _load(data / "matchups" / f"{c_info['slug']}.json") or {}
    c_wr = float(mu.get("win_rate") or c["win_rate"])
    vs: dict[str, dict[str, Any]] = {}
    for e in mu.get("enemy", []):
        if e["hero"] not in by_name:
            continue
        d = float(e["win_rate"]) - c_wr
        vs[e["hero"]] = {
            "hero": e["hero"],
            "role": role_of[e["hero"]],
            "games": e["games"],
            "centre_win_rate": e["win_rate"],
            "delta": round(d, 2),
            "significant": significant(delta=d, base=c_wr, games=e["games"]),
        }
    worth = [v for v in vs.values() if v["games"] >= 20]

    # this patch's own change to a hero: a mover may be the patch, not the meta
    def in_patch(build: str | None) -> bool:
        return bool(build) and (
            build == issue["patch"] or str(build).startswith(issue["patch"] + ".")
        )

    notes = [
        n
        for n in (_load(data / "patchnotes.json") or {}).get("notes", [])
        if in_patch(n.get("build"))
    ]
    noted = {n.get("build") for n in notes}
    change: dict[str, str] = {}
    for n in notes:
        for hero, entry in n.get("heroes", {}).items():
            change[hero] = (
                "mixed" if hero in change and change[hero] != entry["verdict"] else entry["verdict"]
            )
    for b in (_load(data / "hotfixes.json") or {}).get("builds", []):
        if in_patch(b.get("build")) and b.get("build") not in noted:
            for hero in b.get("heroes", {}):
                change.setdefault(hero, "hotfix")

    def mover(hero: str) -> dict[str, Any]:
        r, b = window[hero], baseline.get(hero)
        return {
            "hero": hero,
            "role": role_of[hero],
            "rank": rank_now.get(hero),
            "rank_before": rank_before.get(hero),
            "delta": rank_before[hero] - rank_now[hero],
            "games": r["games"],
            "win_rate": round(float(r["win_rate"]), 2),
            "win_rate_before": round(float(b["win_rate"]), 2) if b else None,
            "pick": round(float(r["pick"]), 2),
            "ban_rate": round(float(r.get("ban_rate") or 0), 2),
            "vs_centre": vs.get(hero),
            "patch_change": change.get(hero),
            "specs": specs_by_name.get(hero),
        }

    moved = [
        h
        for h in rank_now
        if h in rank_before and h != centre_name and rank_before[h] != rank_now[h]
    ]
    risers = sorted(
        (h for h in moved if rank_before[h] > rank_now[h]),
        key=lambda h: (rank_now[h] - rank_before[h], rank_now[h]),
    )[:MOVERS]
    fallers = sorted(
        (h for h in moved if rank_before[h] < rank_now[h]),
        key=lambda h: (rank_before[h] - rank_now[h], -rank_now[h]),
    )[:MOVERS]
    ev: dict[str, Any] = {
        "week": week,
        "mode": MODE,
        "kind": issue["kind"],
        "patch": issue["patch"],
        "baseline": issue.get("baseline"),
        "matches": view["window"].get("matches"),
        "centre": {
            "hero": centre_name,
            "role": c_info["role"],
            "games": c["games"],
            "win_rate": round(float(c["win_rate"]), 2),
            "pick": round(float(c["pick"]), 2),
            "ban_rate": round(float(c.get("ban_rate") or 0), 2),
            "presence": round(float(c["pick"]) + float(c.get("ban_rate") or 0), 2),
            "rank": rank_now.get(centre_name),
            "profile": {
                "specs": specs_by_name.get(centre_name),
                "life_rank_role": _rank(lives, centre_name, same_role),
                "life_rank_all": _rank(lives, centre_name, everyone),
                "averages": profile_avgs,
            },
            "matchups": {
                "overall_win_rate": c_wr,
                "games": mu.get("games"),
                "held_by": sorted((v for v in worth if v["delta"] < 0), key=lambda v: v["delta"])[
                    :MATCHUPS_SHOWN
                ],
                "crushes": sorted((v for v in worth if v["delta"] > 0), key=lambda v: -v["delta"])[
                    :MATCHUPS_SHOWN
                ],
            },
        },
        "risers": [mover(h) for h in risers],
        "fallers": [mover(h) for h in fallers],
        "new_heroes": sorted(h for h in window if h not in baseline) if baseline else [],
    }
    # what each cited hero can do and what players pick on it: the prose explains a number by
    # the kit and the talents (owner 2026-10-05: "hard to catch" is Void Step, not a stat)
    picks = (_load(data / "weekly" / f"{week}.talents.json") or {}).get("heroes") or {}
    ev["heroes"] = {
        h: {
            "kit": _kit(data, by_name[h]["slug"]),
            "talents": _talents(picks.get(h), data, by_name[h]["slug"]),
        }
        for h in cited_heroes(ev)
    }
    return ev


_KEY_ORDER = {"Q": 0, "W": 1, "E": 2, "R": 3, "D": 4}


def _plain(text: str | None) -> str | None:
    return text.replace("{{", "").replace("}}", "") if text else text


def _kit(data: Path, slug: str) -> list[dict[str, Any]]:
    """The hero's abilities in hotkey order: name, what it does, cooldown, cost (game data)."""
    game = (_load(data / "talents" / f"{slug}.json") or {}).get("game") or {}
    kit = [
        {
            "key": a["key"],
            "name": a["ko"],
            **{f: _plain(a[f]) for f in ("desc", "cd", "cost") if a.get(f)},
        }
        for a in (game.get("abilities") or {}).values()
    ]
    return sorted(kit, key=lambda a: (_KEY_ORDER.get(a["key"], 9), a["name"]))


def _talents(
    levels: dict[str, list[dict[str, Any]]] | None, data: Path, slug: str
) -> dict[str, list[dict[str, Any]]] | None:
    """Each level's talents, most played first, each with its name and what it does, and its
    win rate against the most played one (a finding only with games and outside the margin)."""
    if not levels:
        return None
    names = (_load(data / "talents" / f"{slug}.json") or {}).get("talents") or {}
    out: dict[str, list[dict[str, Any]]] = {}
    for level, rows in levels.items():
        top = rows[0]
        out[level] = []
        for i, t in enumerate(rows):
            info = names.get(t["talent"]) or {}
            entry = {
                "talent": t["talent"],
                "name": info.get("ko") or t["talent"],
                "desc": _plain(info.get("desc")),
                "games": t["games"],
                "popularity": t["popularity"],
                "win_rate": round(t["win_rate"], 2),
            }
            if i:
                d = t["win_rate"] - top["win_rate"]
                entry["vs_top"] = round(d, 2)
                entry["significant"] = significant(delta=d, base=top["win_rate"], games=t["games"])
            out[level].append(entry)
    return out


MOVERS_CITED = 3
MAX_CITED = 10


def cited_heroes(ev: dict[str, Any]) -> list[str]:
    """The heroes the prose explains: the centre, the heroes whose matchup with it is a finding,
    then the three biggest climbs and falls — at most ten (one talent call each)."""
    c = ev["centre"]
    m = c["matchups"]
    order = [
        c["hero"],
        *(v["hero"] for v in m["held_by"] + m["crushes"] if v["significant"]),
        *(r["hero"] for r in ev["risers"][:MOVERS_CITED]),
        *(r["hero"] for r in ev["fallers"][:MOVERS_CITED]),
    ]
    return list(dict.fromkeys(order))[:MAX_CITED]


def _gap(v: dict[str, Any]) -> str:
    star = " *" if v["significant"] else ""
    return f"{v['centre_win_rate']}% ({v['games']}g, {v['delta']:+.1f}{star})"


def summary(ev: dict[str, Any]) -> str:
    c = ev["centre"]
    head = f"# {ev['week']} · {ev['mode'].upper()} · patch {ev['patch']} · {ev['matches']} matches"
    lines = [f"{head} · baseline {ev['baseline']}"]
    use = f"pick {c['pick']} ban {c['ban_rate']} wr {c['win_rate']} on {c['games']} games"
    lines.append(f"centre: {c['hero']} ({c['role']}) {use}, rank {c['rank']}")
    p = c["profile"]
    lines.append(f"  specs: {p['specs']}")
    lines.append(f"  life rank in role {p['life_rank_role']} overall {p['life_rank_all']}")
    for k, v in p["averages"].items():
        at = f"{v['rank_all']}/{v['of_all']} all, {v['rank_role']}/{v['of_role']} role"
        lines.append(f"  {k}: {v['value']:.1f} rank {at} (role median {v['role_median']:.1f})")
    m = c["matchups"]
    lines.append(f"  matchups (centre overall {m['overall_win_rate']} on {m['games']}):")
    for label in ("held_by", "crushes"):
        lines.append(f"   {label}: " + "; ".join(f"{v['hero']} {_gap(v)}" for v in m[label]))
    for label in ("risers", "fallers"):
        lines.append(f"{label}:")
        for r in ev[label]:
            rel = f"centre vs it {_gap(r['vs_centre'])}" if r["vs_centre"] else "no matchup"
            patch = f" · patch: {r['patch_change']}" if r["patch_change"] else ""
            move = f"#{r['rank_before']}→#{r['rank']} wr {r['win_rate_before']}→{r['win_rate']}"
            lines.append(f"  {r['hero']} ({r['role']}) {move} ({r['games']}g) · {rel}{patch}")
    lines.append(f"new heroes: {ev['new_heroes']}")
    for hero, h in (ev.get("heroes") or {}).items():
        lines.append(f"== {hero}")
        for a in h["kit"]:
            cd = f" ({a['cd']})" if a.get("cd") else ""
            lines.append(f"  [{a['key']}] {a['name']}{cd}: {(a.get('desc') or '')[:160]}")
        for level, rows in (h["talents"] or {}).items():
            picks = "; ".join(
                f"{t['name']} {t['popularity']:.0f}% wr {t['win_rate']:.1f}"
                + (
                    f" ({t['vs_top']:+.1f}{' *' if t['significant'] else ''})"
                    if "vs_top" in t
                    else ""
                )
                for t in rows
            )
            lines.append(f"  L{level}: {picks}")
    lines.append("(* = 100+ games and outside the 95 % margin: a finding; the rest are hunches)")
    return "\n".join(lines)

"""hpgg.win's 영웅 상세 for the owner MCP: the same files, rules and reference patch as the page.

Ported from web/src/lib (hero.ts, matchups.ts, tiers.ts, length.ts, shown.ts) and checked against
tests/fixtures/hero_views_golden.json, which the TypeScript writes: change a rule there, regenerate
the fixture, and the Python test says this copy has to follow. Patch changes are given as the
files hold them (the page's merging of announced hotfixes is not ported).
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from server.mcp.names import GameNames
from server.mcp.tiers import compute_tiers, snapshot_key

REGIONS = ("all", "kr", "na", "eu")
BRACKET_TIERS: dict[str, list[int] | None] = {"all": None, "low": [1, 2, 3, 4], "high": [5, 6]}
LEAGUES = ("bronze", "silver", "gold", "platinum", "diamond", "master")
TIER_MIN_GAMES = 30
LENGTH_BANDS = ("short", "mid", "long")
LENGTH_MIN_GAMES = 30
MATCHUP_K, MATCHUP_MIN_GAMES, MATCHUP_TOP, MATCHUP_Z = 100, 50, 5, 1.96
BUILD_K, BUILD_MARGIN, BUILD_MIN_GAMES, BUILDS_SHOWN = 100, 5, 30, 5
RULES = {
    "summary": "tier table rank among heroes with ≥ min_games games in the view (get_tier_list)",
    "maps": "maps under min_games are thin: listed by games, not by win rate",
    "by_league": f"party-corrected win rate per league, 95% Wilson interval; thin under "
    f"{TIER_MIN_GAMES} games; average = all heroes' games-weighted rate in that league",
    "by_length": f"win rate per game-length band, null under {LENGTH_MIN_GAMES} games; vs_hero = "
    "band rate − the hero's rate over all bands; lean decided by the collector (z ≥ 1.96)",
    "matchups": f"pairs with ≥ {MATCHUP_MIN_GAMES} games; expected = own rate ± (other hero's own "
    f"rate − 50); score = (pair − expected) × n/(n+{MATCHUP_K}); only pairs beyond the error "
    f"(z ≥ {MATCHUP_Z}); top {MATCHUP_TOP}",
    "builds": f"score = games × (WRs − (avg − {BUILD_MARGIN})), WRs shrunk to the hero's average "
    f"with k={BUILD_K}; top {BUILDS_SHOWN}; thin under {BUILD_MIN_GAMES} games; all = both "
    "brackets added up",
}


def _read(path: Path) -> dict[str, Any] | None:
    try:
        data: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def wilson(wins: float, games: float, z: float = 1.96) -> tuple[float, float]:
    if games <= 0:
        return 0.0, 100.0
    p = wins / games
    z2 = z * z
    denom = 1 + z2 / games
    centre = (p + z2 / (2 * games)) / denom
    half = (z * math.sqrt(p * (1 - p) / games + z2 / (4 * games * games))) / denom
    return max(0.0, (centre - half) * 100), min(100.0, (centre + half) * 100)


# -- views (ported, golden-checked) ---------------------------------------------------------


def strength_of(rows: list[dict[str, Any]]) -> dict[str, float]:
    return {r["hero"]: r["win_rate"] for r in rows if r.get("map") == "all" and r["games"] > 0}


def _beyond_error(pair: float, own: float, games: float) -> bool:
    p = own / 100
    se = math.sqrt(p * (1 - p) / games) * 100 if games > 0 else 0.0
    return games > 0 and se > 0 and abs(pair - own) / se >= MATCHUP_Z


def matchups_view(file: dict[str, Any], strength: dict[str, float]) -> dict[str, Any]:
    def rows(pairs: list[dict[str, Any]], side: str) -> list[dict[str, Any]]:
        out = []
        for p in pairs:
            if p["games"] < MATCHUP_MIN_GAMES:
                continue
            lift = strength.get(p["hero"], 50) - 50
            expected = file["win_rate"] + lift if side == "ally" else file["win_rate"] - lift
            out.append(
                {
                    "hero": p["hero"],
                    "games": p["games"],
                    "win_rate": p["win_rate"],
                    "expected": expected,
                    "delta": p["win_rate"] - expected,
                    "score": (p["win_rate"] - expected) * (p["games"] / (p["games"] + MATCHUP_K)),
                }
            )
        return out

    counters = [
        r
        for r in rows(file.get("enemy", []), "enemy")
        if r["score"] < 0 and _beyond_error(r["win_rate"], r["expected"], r["games"])
    ]
    synergies = [
        r
        for r in rows(file.get("ally", []), "ally")
        if r["score"] > 0 and _beyond_error(r["win_rate"], r["expected"], r["games"])
    ]
    counters.sort(key=lambda r: r["score"])
    synergies.sort(key=lambda r: -r["score"])
    return {
        "patch": file.get("patch"),
        "collected_at": file.get("collected_at"),
        "win_rate": file.get("win_rate"),
        "games": file.get("games"),
        "counters": counters[:MATCHUP_TOP],
        "synergies": synergies[:MATCHUP_TOP],
    }


def _build_base(builds: list[dict[str, Any]]) -> float:
    games = sum(b["games"] for b in builds)
    return sum(b["games"] * b["win_rate"] for b in builds) / games if games > 0 else 50.0


def _build_score(games: float, win_rate: float, base: float) -> float:
    if games <= 0:
        return 0.0
    wrs = base + (win_rate - base) * games / (games + BUILD_K)
    return games * (wrs - (base - BUILD_MARGIN))


def _merge(lists: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    by: dict[str, dict[str, Any]] = {}
    for x in (b for lst in lists for b in lst):
        key = "|".join(t["name"] for t in x["talents"])
        m = by.setdefault(key, {"games": 0, "wins": 0.0, "talents": x["talents"]})
        m["games"] += x["games"]
        m["wins"] += x["win_rate"] * x["games"] / 100
    return [
        {
            "games": m["games"],
            "win_rate": m["wins"] / m["games"] * 100 if m["games"] else 0,
            "talents": m["talents"],
        }
        for m in by.values()
    ]


def builds_view(
    file: dict[str, Any] | None, hero: str, talents: dict[str, Any]
) -> dict[str, list[dict[str, Any]]]:
    """The page's builds by bracket ("all", "high", "low"), each talent with its Korean name."""

    def view(lst: list[dict[str, Any]], hero_games: int | None) -> list[dict[str, Any]]:
        base = _build_base(lst)
        ranked = sorted(
            lst, key=lambda x: (-_build_score(x["games"], x["win_rate"], base), -x["games"])
        )[:BUILDS_SHOWN]
        return [
            {
                "games": x["games"],
                "win_rate": x["win_rate"],
                "pick": x["games"] / hero_games * 100 if hero_games else None,
                "thin": x["games"] < BUILD_MIN_GAMES,
                "talents": [
                    {
                        "level": t["level"],
                        "talent_key": t["name"],
                        "title_en": t.get("title"),
                        "ko": (talents.get(t["name"]) or {}).get("ko") or t.get("title"),
                    }
                    for t in x["talents"]
                ],
            }
            for x in ranked
        ]

    found = []
    for key in ("high", "low"):
        b = ((file or {}).get("brackets") or {}).get(key)
        lst = (b or {}).get("heroes", {}).get(hero) or []
        if b and lst:
            found.append((key, lst, b.get("hero_games", {}).get(hero)))
    out: dict[str, list[dict[str, Any]]] = {}
    if len(found) == 2:
        n = sum(f[2] for f in found) if all(f[2] for f in found) else None
        out["all"] = view(_merge([f[1] for f in found]), n)
    for key, lst, n in found:
        out[key] = view(lst, n)
    return out


def tiers_view(file: dict[str, Any] | None, hero: str) -> dict[str, Any] | None:
    rows = (file or {}).get("heroes", {}).get(hero)
    if not file or not rows:
        return None
    averages: list[float | None] = []
    for i in range(len(LEAGUES)):
        games, total = 0, 0.0
        for h in file["heroes"].values():
            r = h[i]
            if r and r["games"]:
                games += r["games"]
                total += r["tier_win_rate"] * r["games"]
        averages.append(total / games if games else None)
    points = []
    for i, league in enumerate(LEAGUES):
        r, avg = rows[i], averages[i]
        if not r or not r["games"]:
            points.append(
                {"league": league, "games": 0, "winRate": None, "low": None, "high": None,
                 "thin": True, "average": avg, "vsAverage": None}
            )  # fmt: skip
            continue
        lo, hi = wilson(r["wins"], r["games"])
        shift = r["tier_win_rate"] - r["wins"] / r["games"] * 100
        points.append(
            {
                "league": league,
                "games": r["games"],
                "winRate": r["tier_win_rate"],
                "low": lo + shift,
                "high": hi + shift,
                "thin": r["games"] < TIER_MIN_GAMES,
                "average": avg,
                "vsAverage": None if avg is None else r["tier_win_rate"] - avg,
            }
        )
    return {
        "patch": file["patch"],
        "collectedAt": file["collected_at"],
        "games": sum(p["games"] for p in points),
        "points": points,
    }


def _kst_day(iso: str) -> str:
    d = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(UTC) + timedelta(hours=9)
    return f"{d.month}/{d.day}"


def length_view(
    file: dict[str, Any] | None, hero: str, window: dict[str, Any] | None
) -> dict[str, Any] | None:
    h = (file or {}).get("heroes", {}).get(hero)
    if not file or not h:
        return None
    games = sum(h[b]["games"] for b in LENGTH_BANDS)
    rate = sum(h[b]["wins"] for b in LENGTH_BANDS) / games * 100 if games else 50
    bands = []
    for b in LENGTH_BANDS:
        n, wins = h[b]["games"], h[b]["wins"]
        wr = wins / n * 100 if n >= LENGTH_MIN_GAMES else None
        bands.append(
            {"band": b, "games": n, "winRate": wr, "vsHero": None if wr is None else wr - rate}
        )
    since = file.get("since")
    w = window or {}
    return {
        "patch": file["patch"],
        "collectedAt": file["collected_at"],
        "sample": file["games"],
        "games": games,
        "heroRate": rate,
        "sinceDay": _kst_day(w["since_at"])
        if since and w.get("since") == since and w.get("since_at")
        else None,
        "bands": bands,
        "lean": h.get("lean"),
    }


# -- the page -------------------------------------------------------------------------------


class SiteData:
    """data/ as the site's build reads it, on the reference patch."""

    def __init__(self, data_dir: Path) -> None:
        self.dir = data_dir
        self.meta = _read(data_dir / "latest" / "meta.json") or {}
        prev = self.meta.get("previous_patch")
        self.on_previous = bool(prev) and self.meta.get("reference_patch") == prev
        self.reference_id = prev if self.on_previous else self.meta.get("current_patch")
        self.min_games = int(self.meta.get("min_games_for_tier") or 50)

    def on_reference(self, file: dict[str, Any] | None) -> dict[str, Any] | None:
        return file if file and file.get("patch") == self.reference_id else None

    def snapshot(self, key: str, patch: str) -> dict[str, Any] | None:
        return _read(self.dir / ("previous" if patch == "previous" else "latest") / f"{key}.json")

    def shown(
        self, mode: str, bracket: str, region: str, names: GameNames
    ) -> tuple[dict[str, Any], dict[str, Any] | None, bool] | None:
        """(snapshot, previous patch's for ▲▼, fallback) like web/src/lib/shown.ts pickShown."""
        key = snapshot_key(mode, bracket, region)
        want_tiers = BRACKET_TIERS[bracket]
        want_region = None if region == "all" else region.upper()

        def valid(s: dict[str, Any] | None) -> dict[str, Any] | None:
            if not s:
                return None
            have = s.get("league_tier")
            if (want_tiers is None) != (have is None):
                return None
            if want_tiers is not None and sorted(have or []) != want_tiers:
                return None
            if (s.get("region") or None) != want_region:
                return None
            return {**s, "rows": [r for r in s.get("rows", []) if names.hero_ko(r.get("hero"))]}

        if self.on_previous:
            prev = valid(self.snapshot(key, "previous"))
            return (prev, None, True) if prev else None
        cur = valid(self.snapshot(key, "current"))
        prev = valid(self.snapshot(key, "previous")) if self.meta.get("previous_patch") else None
        return (cur, prev, False) if cur else None


def _same_cohort(a: dict[str, Any], b: dict[str, Any]) -> bool:
    def key(s: dict[str, Any]) -> tuple[Any, Any]:
        t = s.get("league_tier")
        return (tuple(sorted(t)) if t else "all", s.get("region") or "all")

    return key(a) == key(b)


def _place(snap: dict[str, Any], m: str, hero: str, min_games: int) -> tuple[Any, Any, int]:
    rows = [r for r in snap.get("rows", []) if r.get("map") == m]
    t = compute_tiers(rows, min_games)
    ranked = next((x for x in t.ranked if x.hero == hero), None)
    grey = next((r for r in rows if r["hero"] == hero and r["games"] < min_games), None)
    return ranked, grey, len(t.ranked)


def summary(
    snap: dict[str, Any], previous: dict[str, Any] | None, hero: str, min_games: int, m: str
) -> dict[str, Any]:
    r, grey, n = _place(snap, m, hero, min_games)
    prev = previous if previous and _same_cohort(previous, snap) else None
    if r:
        pr = _place(prev, m, hero, min_games)[0] if prev else None
        prev_rank = pr.rank if pr else None
        return {
            "kind": "ranked",
            "tier": r.tier,
            "rank": r.rank,
            "of": n,
            "prev_rank": prev_rank,
            "rank_change": None if prev_rank is None else prev_rank - r.rank,
            "win_rate": r.row["win_rate"],
            "games": r.row["games"],
            "pick": r.row["pick"],
            "ban_rate": r.row.get("ban_rate"),
        }
    row = grey or {"win_rate": None, "games": 0, "pick": 0, "ban_rate": None}
    return {
        "kind": "unranked",
        "tier": None,
        "rank": None,
        "of": n,
        "prev_rank": None,
        "rank_change": None,
        "win_rate": row["win_rate"],
        "games": row["games"],
        "pick": row["pick"],
        "ban_rate": row.get("ban_rate"),
    }


def map_rows(
    snap: dict[str, Any], hero: str, names: GameNames, maps: list[dict[str, Any]], min_games: int
) -> list[dict[str, Any]]:
    in_view = {r.get("map") for r in snap.get("rows", [])}
    out = []
    for m in maps:
        row = next(
            (r for r in snap.get("rows", []) if r.get("map") == m["name"] and r["hero"] == hero),
            None,
        )
        if row:
            out.append(
                {"map": m["name"], "map_ko": m.get("ko"), "win_rate": row["win_rate"],
                 "pick": row["pick"], "games": row["games"], "thin": row["games"] < min_games}
            )  # fmt: skip
        elif m["name"] in in_view:
            out.append(
                {"map": m["name"], "map_ko": m.get("ko"), "win_rate": None, "pick": 0,
                 "games": 0, "thin": True}
            )  # fmt: skip
    out.sort(key=lambda x: (x["thin"], -x["games"] if x["thin"] else -(x["win_rate"] or 0)))
    return out


def patch_changes(data_dir: Path, hero: str, limit: int = 5) -> list[dict[str, Any]]:
    """The hero's entries in the official notes and the detected hotfixes, newest first, as the
    files hold them."""
    items: list[dict[str, Any]] = []
    for n in (_read(data_dir / "patchnotes.json") or {}).get("notes", []):
        entry = (n.get("heroes") or {}).get(hero)
        if entry:
            items.append(
                {"kind": "patch_note", "published": n.get("published"), "build": n.get("build"),
                 "title": n.get("title"), "url": n.get("url"), "verdict": entry.get("verdict"),
                 "groups": entry.get("groups")}
            )  # fmt: skip
        for fix in n.get("hotfixes") or []:
            e = (fix.get("heroes") or {}).get(hero)
            if e:
                items.append(
                    {"kind": "announced_hotfix", "published": fix.get("date"),
                     "build": n.get("build"), "title": n.get("title"), "url": n.get("url"),
                     "verdict": e.get("verdict"), "groups": e.get("groups")}
                )  # fmt: skip
    for b in (_read(data_dir / "hotfixes.json") or {}).get("builds", []):
        changes = (b.get("heroes") or {}).get(hero)
        if changes:
            items.append(
                {"kind": "detected_hotfix", "published": b.get("first_seen"),
                 "build": b.get("build"), "changes": changes}
            )  # fmt: skip
    items.sort(key=lambda x: str(x.get("published") or ""), reverse=True)
    return items[:limit]


def hero_page(
    data_dir: Path,
    names: GameNames,
    hero: str,
    mode: str,
    bracket: str,
    region: str,
    map_name: str,
) -> dict[str, Any]:
    site = SiteData(data_dir)
    maps = (_read(data_dir / "maps_ko.json") or {}).get("maps", [])
    slug = names.hero_slug(hero)
    out: dict[str, Any] = {
        "hero": hero,
        "hero_ko": names.hero_ko(hero),
        "role": names.hero_role(hero),
        "view": {"mode": mode, "bracket": bracket, "region": region, "map": map_name},
        "reference_patch": site.reference_id,
        "on_previous_patch": site.on_previous,
        "min_games": site.min_games,
        "rules": RULES,
    }
    shown = site.shown(mode, bracket, region, names)
    if shown:
        snap, prev, _ = shown
        out.update(
            patch=snap.get("patch"),
            collected_at=snap.get("collected_at"),
            summary=summary(snap, prev, hero, site.min_games, map_name),
            maps=map_rows(snap, hero, names, maps, site.min_games),
        )
    else:
        out.update(summary=None, maps=None, view_note="this view has no file")
    brackets = ["all", "low", "high"] if mode == "sl" else ["all"]
    grid: list[dict[str, Any]] = []
    for r in REGIONS:
        cells: list[dict[str, Any]] = []
        for b in brackets:
            s = site.shown(mode, b, r, names)
            if not s:
                cells.append({"bracket": b, "sample": "uncollected"})
                continue
            ranked, grey, n = _place(s[0], "all", hero, site.min_games)
            row = ranked.row if ranked else grey
            cells.append(
                {
                    "bracket": b,
                    "tier": ranked.tier if ranked else None,
                    "rank": ranked.rank if ranked else None,
                    "of": n,
                    "win_rate": row["win_rate"] if row else None,
                    "games": row["games"] if row else 0,
                    "sample": "ranked" if ranked else ("thin" if grey else "zero"),
                }
            )
        grid.append({"region": r, "cells": cells})
    out["grid"] = grid
    world = "sl, all regions, all maps"
    tiers = tiers_view(site.on_reference(_read(data_dir / "latest" / "sl_tiers.json")), hero)
    out["by_league"] = {**tiers, "scope": world} if tiers else None
    length = length_view(
        site.on_reference(_read(data_dir / "latest" / "sl_length.json")),
        hero,
        site.meta.get("window"),
    )
    out["by_length"] = {**length, "scope": world} if length else None
    mu = site.on_reference(_read(data_dir / "matchups" / f"{slug}.json")) if slug else None
    sl = site.shown("sl", "all", "all", names)
    out["matchups"] = (
        {**matchups_view(mu, strength_of(sl[0]["rows"] if sl else [])), "scope": world}
        if mu
        else None
    )
    talents = (
        (_read(data_dir / "talents" / f"{slug}.json") or {}).get("talents", {}) if slug else {}
    )
    builds = builds_view(
        site.on_reference(_read(data_dir / "latest" / "builds.json")), hero, talents
    )
    out["builds"] = builds or None
    out["builds_scope"] = "sl, all regions, all maps; all = low + high brackets"
    out["patch_changes"] = patch_changes(data_dir, hero)
    return out

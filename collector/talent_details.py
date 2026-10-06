"""Talent picks of the heroes a weekly report cites (owner 2026-10-05).

HP `/heroes/talents/details` answers one hero per call: every talent of every level with its
games, wins, popularity and win rate (live probe 2026-10-05, Xal'atath, Storm League 2.57.0:
Anchored Core picked in 73 % of games at level 1, winning 70.9 %; Void Adept 18 %, 56.2 %). It has
its own weekly bucket (210 on Intermediate) that nothing else uses.

On the run that writes a new issue, the collector asks for the heroes its evidence cites (the
meta's centre, the heroes that answer it, the biggest movers; collector/evidence.py) and writes
data/weekly/<week>.talents.json once. Like the matchups, the numbers are the patch to date, not
the week. A failed hero is left out and a spent allowance stops the asking; neither fails the
run: the prose can still be written without them.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import structlog

from collector.averages import last_builds
from collector.client import HPClient, HPError, SleepFn
from collector.config import Settings
from collector.evidence import build_evidence, cited_heroes

log = structlog.get_logger(__name__)

GAME_TYPE = "sl"
LEVELS = ("1", "4", "7", "10", "13", "16", "20")


def normalize(raw: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """HP's answer → {level: [{talent, games, wins, popularity, win_rate}]}, most played first."""
    out: dict[str, list[dict[str, Any]]] = {}
    for level in LEVELS:
        rows = [
            {
                "talent": str(r["talentInfo"]["talent_name"]),
                "games": int(r.get("games_played") or 0),
                "wins": int(r.get("wins") or 0),
                "popularity": float(r.get("popularity") or 0),
                "win_rate": float(r.get("win_rate") or 0),
            }
            for r in raw.get(level) or []
            if (r.get("talentInfo") or {}).get("talent_name")
        ]
        if rows:
            out[level] = sorted(rows, key=lambda t: (-t["games"], t["talent"]))
    return out


async def collect_talent_details(
    c: HPClient,
    settings: Settings,
    *,
    heroes: list[str],
    patch: str,
    timeframe: str,
    collected_at: str,
    sleep: SleepFn,
) -> dict[str, Any]:
    """{patch, game_type, collected_at, builds, heroes: {hero: {level: [talent…]}}}."""
    builds = last_builds(timeframe)
    got: dict[str, Any] = {}
    for i, hero in enumerate(heroes):
        if i:
            await sleep(settings.map_call_spacing_seconds)
        try:
            raw = await c.get_json(
                "/heroes/talents/details",
                params={
                    "timeframe_type": "minor",
                    "timeframe": builds,
                    "game_type": GAME_TYPE,
                    "hero": hero,
                    "mode": "json",
                },
            )
        except HPError as e:
            log.warning("talents.hero_failed", hero=hero, code=e.code, status=e.status)
            if e.code in {"quota_exceeded", "rate_limited"} or e.status == 429:
                break
            continue
        levels = normalize(raw) if isinstance(raw, dict) else {}
        if levels:
            got[hero] = levels
    return {
        "patch": patch,
        "game_type": GAME_TYPE,
        "collected_at": collected_at,
        "builds": builds,
        "heroes": got,
    }


async def fetch_weekly_talents(
    c: HPClient,
    settings: Settings,
    *,
    weeks: list[str],
    patch: str,
    timeframe: str,
    collected_at: str,
    sleep: SleepFn,
) -> None:
    """For each issue of `patch` without a talent file: its cited heroes' talents, written once."""
    for week in weeks:
        issue_path = settings.data_dir / "weekly" / f"{week}.json"
        out_path = settings.data_dir / "weekly" / f"{week}.talents.json"
        if not issue_path.exists() or out_path.exists():
            continue
        if json.loads(issue_path.read_text(encoding="utf-8")).get("patch") != patch:
            continue
        heroes = cited_heroes(build_evidence(settings.data_dir, week))
        out = await collect_talent_details(
            c,
            settings,
            heroes=heroes,
            patch=patch,
            timeframe=timeframe,
            collected_at=collected_at,
            sleep=sleep,
        )
        if not out["heroes"]:
            log.warning("talents.none", week=week)
            continue
        _write(out_path, out)
        log.info("talents.done", week=week, heroes=sorted(out["heroes"]))


def _write(path: Path, obj: Any) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)

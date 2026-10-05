"""Storm League average stats per hero, for the weekly report (owner 2026-10-05).

HP `/heroes/stats?statfilter=<stat>` answers each hero's average per game of that stat in
`total_filter_type` (checked live 2026-10-05: Xal'atath hero_damage 72,730 per game, first of
91). It needs `timeframe_type=minor` and at most five builds. One call per stat on the weekly
Heroes/Stats bucket (210), so the set is fetched about once a week, and a failure keeps the
previous file: these numbers support sentences, they are not the tier table.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import structlog

from collector.client import HPClient, SleepFn
from collector.config import Settings

log = structlog.get_logger(__name__)

STATS = ("hero_damage", "healing", "damage_taken", "deaths", "siege_damage")
GAME_TYPE = "sl"
MAX_BUILDS = 5
REFRESH = timedelta(days=6)


def last_builds(timeframe: str) -> str:
    """The newest five builds of a patch (the endpoint takes no more with a statfilter)."""
    return ",".join(timeframe.split(",")[-MAX_BUILDS:])


def _at(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def due(path: Path, *, patch: str, collected_at: str) -> bool:
    """Fetch when there is no set yet, it is for another patch, or it is a week old."""
    try:
        old = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return True
    if old.get("patch") != patch:
        return True
    return _at(collected_at) - _at(str(old.get("collected_at"))) >= REFRESH


async def collect_averages(
    c: HPClient,
    settings: Settings,
    *,
    patch: str,
    timeframe: str,
    collected_at: str,
    sleep: SleepFn,
) -> dict[str, Any]:
    """{patch, game_type, collected_at, builds, stats: {stat: {hero: avg}}, average: {stat: avg
    of all heroes}, games: {hero: games}}. Any failed call raises: a partial set is no set."""
    builds = last_builds(timeframe)
    stats: dict[str, dict[str, float]] = {}
    average: dict[str, float] = {}
    games: dict[str, int] = {}
    for i, stat in enumerate(STATS):
        if i:
            await sleep(settings.map_call_spacing_seconds)
        raw = await c.get_json(
            "/heroes/stats",
            params={
                "timeframe_type": "minor",
                "timeframe": builds,
                "game_type": GAME_TYPE,
                "statfilter": stat,
                "mode": "json",
            },
        )
        rows = raw.get("data") if isinstance(raw, dict) else None
        if not isinstance(rows, list) or not rows:
            raise ValueError(f"statfilter {stat}: no rows")
        stats[stat] = {
            str(r["name"]): float(r["total_filter_type"])
            for r in rows
            if r.get("total_filter_type") is not None
        }
        average[stat] = float(raw.get("average_total_filter_type") or 0)
        for r in rows:
            games[str(r["name"])] = int(r.get("games_played") or 0)
        log.info("averages.stat", stat=stat, heroes=len(stats[stat]))
    return {
        "patch": patch,
        "game_type": GAME_TYPE,
        "collected_at": collected_at,
        "builds": builds,
        "stats": stats,
        "average": average,
        "games": games,
    }

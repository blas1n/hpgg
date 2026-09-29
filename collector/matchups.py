"""`/heroes/matchups` → data/matchups/<slug>.json (counters and synergies on the hero page).

Recorded 2026-09-29 (Abathur, sl, minor 2.55.17.98025 — tests/fixtures/live_probe_matchups_*):
- one hero per call; answer `{"ally": [...], "enemy": [...], "combined": [...]}` with one row per
  other hero: `{hero: {name, ...}, role, wins, losses, games_played, win_rate, hovertext}`.
- `wins`/`losses` are the asked hero's on both lists, but `win_rate` is not: on `enemy` it is the
  LOSS rate ("Lost against a team with Fenix 59.62% of games"). We recompute from wins/games.
- `combined` repeats ally/enemy with the other hero's overall stats — not stored.
- bucket Hero/Matchups 700/rolling week; 60 requests/minute (X-RateLimit-Limit without
  group_by_map); cache hits answer 200 straight away, misses go through 202 polling.

Schedule (owner, 2026-09-29, Basic plan): Storm League only, each hero at most every other day —
a hero is due when its file is missing, is for another patch, or was collected ≥ 2 calendar days
(UTC) ago. The gate is per file, so a failed or cut-short run is healed the next day. At 90
heroes that is 315 calls/week; a patch change can add one extra round (≤ 450, under 700).
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import structlog

from collector.client import HPClient, HPError, SleepFn
from collector.config import Settings

log = structlog.get_logger(__name__)

MATCHUP_GAME_TYPE = "sl"
MATCHUP_EVERY_DAYS = 2
THIN_SHARE = 0.5  # same as web/src/data.ts thinSample: < half the heroes over the tier floor


@dataclass
class MatchupsResult:
    written: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    skipped_fresh: int = 0
    stopped: str | None = None  # "quota_exceeded" | "time_budget"


def _pair_rows(rows: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not isinstance(rows, list):
        return out
    for r in rows:
        if not isinstance(r, dict):
            continue
        h = r.get("hero")
        name = h.get("name") if isinstance(h, dict) else h
        try:
            games = int(r.get("games_played") or 0)
            wins = int(r.get("wins") or 0)
        except (TypeError, ValueError):
            continue
        if not isinstance(name, str) or not name or games <= 0:
            continue
        out.append(
            {"hero": name, "games": games, "wins": wins, "win_rate": round(wins / games * 100, 2)}
        )
    return out


def normalize_matchups(raw: Any, *, hero: str, patch: str, collected_at: str) -> dict[str, Any]:
    """The frontend contract: matchups/<slug>.json. Rows carry the hero's win rate with (ally)
    or against (enemy) the other hero; `games`/`wins`/`win_rate` at the top are the hero's own
    record in the same sample (every game is counted 4× on ally rows)."""
    if not isinstance(raw, dict):
        raise ValueError("matchups payload is not an object")
    ally = _pair_rows(raw.get("ally"))
    enemy = _pair_rows(raw.get("enemy"))
    if not ally or not enemy:
        raise ValueError("matchups payload had no ally/enemy rows")
    ally_games = sum(r["games"] for r in ally)
    ally_wins = sum(r["wins"] for r in ally)
    return {
        "hero": hero,
        "patch": patch,
        "game_type": MATCHUP_GAME_TYPE,
        "collected_at": collected_at,
        "games": round(ally_games / 4),
        "wins": round(ally_wins / 4),
        "win_rate": round(ally_wins / ally_games * 100, 2),
        "ally": ally,
        "enemy": enemy,
    }


def matchups_due(existing: dict[str, Any] | None, *, patch: str, today: date) -> bool:
    """Every other day per hero; immediately when the file is missing or for another patch."""
    if not existing or existing.get("patch") != patch:
        return True
    try:
        collected = date.fromisoformat(str(existing.get("collected_at", ""))[:10])
    except ValueError:
        return True
    return (today - collected).days >= MATCHUP_EVERY_DAYS


def matchups_patch(meta: dict[str, Any]) -> str:
    """The patch the hero page shows for Storm League: the previous one while the current
    sample is thin (the web rule), otherwise the current one."""
    current = str(meta["current_patch"])
    previous = meta.get("previous_patch")
    sl = (meta.get("modes") or {}).get(MATCHUP_GAME_TYPE) or {}
    heroes = sl.get("heroes") or 0
    if previous and heroes and sl.get("heroes_over_200", 0) / heroes < THIN_SHARE:
        return str(previous)
    return current


def _read(path: Path) -> dict[str, Any] | None:
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return loaded if isinstance(loaded, dict) else None


def _write_atomic(path: Path, obj: Any) -> None:
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def load_hero_list(data_dir: Path) -> list[tuple[str, str]]:
    """(API name, slug) for every hero on the site, from data/heroes_ko.json."""
    table = _read(data_dir / "heroes_ko.json") or {}
    return [
        (str(h["name"]), str(h["slug"]))
        for h in table.get("heroes", [])
        if isinstance(h, dict) and h.get("name") and h.get("slug")
    ]


async def collect_matchups(
    c: HPClient,
    settings: Settings,
    *,
    heroes: list[tuple[str, str]],
    patch: str,
    collected_at: str,
    sleep: SleepFn,
    clock: Callable[[], float] = time.monotonic,
) -> MatchupsResult:
    """One call per due hero, spaced, each file replaced on its own. A failure keeps that
    hero's previous file; quota_exceeded or the time budget stops the loop."""
    out = settings.data_dir / "matchups"
    out.mkdir(parents=True, exist_ok=True)
    today = date.fromisoformat(collected_at[:10])
    res = MatchupsResult()
    started = clock()
    calls = 0
    for name, slug in heroes:
        if not matchups_due(_read(out / f"{slug}.json"), patch=patch, today=today):
            res.skipped_fresh += 1
            continue
        if clock() - started > settings.matchups_budget_seconds:
            res.stopped = "time_budget"
            break
        if calls:
            await sleep(settings.matchups_call_spacing_seconds)
        calls += 1
        params = {
            "hero": name,
            "game_type": MATCHUP_GAME_TYPE,
            "timeframe_type": "minor",
            "timeframe": patch,
            "mode": "json",
        }
        try:
            raw = await c.get_json("/heroes/matchups", params=params)
            doc = normalize_matchups(raw, hero=name, patch=patch, collected_at=collected_at)
        except HPError as e:
            if e.code == "quota_exceeded":
                res.stopped = "quota_exceeded"
                log.warning("matchups.quota_exceeded", hero=name, message=e.message)
                break
            log.warning("matchups.hero_failed", hero=name, status=e.status, code=e.code)
            res.failed.append(slug)
            continue
        except ValueError as e:
            log.warning("matchups.bad_payload", hero=name, error=str(e))
            res.failed.append(slug)
            continue
        _write_atomic(out / f"{slug}.json", doc)
        res.written.append(slug)
    log.info(
        "matchups.done",
        patch=patch,
        written=len(res.written),
        failed=len(res.failed),
        fresh=res.skipped_fresh,
        stopped=res.stopped,
    )
    return res

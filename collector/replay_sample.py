"""Per-game records for the weekly report (owner 2026-10-06).

The report explains the meta on games, not on aggregates: how the central pick changes games,
what is drafted into it, which builds of a counter actually win and how. Heroes Profile lists
replays by id (`/replays?game_type=<sl|qm>&after=<id>`, 1,000 a page, oldest first, with the
newest id as `max_replay_id`; dates and heroes are not filters) and answers one game in full
(`/replay/{id}`, the Replays bucket: 25,000/week on Intermediate): the draft in order, ten players
with hero, talents, MMR and score line, and each team's level and experience every minute.

- About 3,300 Storm League games are uploaded a day (2026-10-06), too many to open every one
  (the bucket is also the player search's). Each run lists the games of the current patch
  uploaded since the cursor and opens an even spread of them: `replay_sl_per_run` Storm League,
  `replay_qm_per_run` Quick Match (Quick Match only checks how builds fare in game: players pick
  before the map and the teams, so it says nothing about the draft).
- A record keeps what the analysis needs and nothing that names a player (no BattleTag, id or
  account level; a party is its size).
- The run stops at `replay_minutes`; a failed game is skipped; neither fails the daily run.

Records go to the day's snapshot folder (`replays_sl.jsonl.gz`, `replays_qm.jsonl.gz`, the
snapshots branch); the cursor to `data/replays/cursor.json`.
"""

from __future__ import annotations

import json
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import structlog

from collector.client import HPClient, HPError, SleepFn
from collector.config import Settings

log = structlog.get_logger(__name__)

GAME_TYPES = {"Storm League": "sl", "Quick Match": "qm"}
LEVEL_KEYS = (
    "level_one",
    "level_four",
    "level_seven",
    "level_ten",
    "level_thirteen",
    "level_sixteen",
    "level_twenty",
)
SCORE_KEYS = (
    "level",
    "takedowns",
    "kills",
    "deaths",
    "assists",
    "hero_damage",
    "siege_damage",
    "structure_damage",
    "minion_damage",
    "creep_damage",
    "summon_damage",
    "healing",
    "self_healing",
    "damage_taken",
    "experience_contribution",
    "time_spent_dead",
    "merc_camp_captures",
    "watch_tower_captures",
    "town_kills",
    "time_cc_enemy_heroes",
    "stunning_enemies",
    "rooting_enemies",
    "silencing_enemies",
    "protection_allies",
    "clutch_heals",
    "escapes",
    "vengeance",
    "outnumbered_deaths",
    "teamfight_escapes",
    "teamfight_healing",
    "teamfight_damage_taken",
    "teamfight_hero_damage",
    "multikill",
    "highest_kill_streak",
    "physical_damage",
    "spell_damage",
    "regen_globes",
    "time_on_fire",
)
MAX_PAGES = 60
CURSOR_FILE = Path("replays") / "cursor.json"


def _hero_name(h: Any) -> str | None:
    name = h.get("name") if isinstance(h, dict) else None
    return None if not name or name == "No Pick" else str(name)


def _players(d: dict[str, Any]) -> list[dict[str, Any]]:
    ps = d.get("players") or []
    flat = [p for team in ps for p in team] if ps and isinstance(ps[0], list) else list(ps)
    return [p for p in flat if isinstance(p, dict)]


def compact(d: dict[str, Any], *, replay_id: int, version: str) -> dict[str, Any] | None:
    """One `/replay/{id}` answer → the record the analysis reads; None if not a usable game."""
    kind = GAME_TYPES.get(str(d.get("game_type")))
    players = _players(d)
    if kind is None or len(players) != 10:
        return None
    team_of = {_hero_name(p.get("hero")): int(p["team"]) for p in players}
    parties = Counter((int(p["team"]), p.get("party")) for p in players if p.get("party"))
    winners = {int(p["team"]) for p in players if p.get("winner")}
    draft = []
    for x in sorted(d.get("draft_order") or [], key=lambda x: int(x.get("pick_number") or 0)):
        hero = _hero_name(x.get("hero"))
        if str(x.get("type")) == "0":  # a ban: player_slot 1 is the first team, 2 the second
            draft.append(["b", int(x.get("player_slot") or 1) - 1, hero])
        else:
            draft.append(["p", team_of.get(hero), hero])
    xp: list[list[int]] = [[], []]
    level: list[list[int]] = [[], []]
    for t in (d.get("experience_breakdown") or {}).get("data") or []:
        team = int(t.get("team") or 0)
        if team in (0, 1):
            xp[team] = [int(m.get("TotalXP") or 0) for m in t.get("data") or []]
            level[team] = [int(m.get("TeamLevel") or 0) for m in t.get("data") or []]
    game_map = d.get("game_map")
    return {
        "id": replay_id,
        "type": kind,
        "version": version,
        "date": d.get("game_date"),
        "region": d.get("region"),
        "map": game_map.get("name") if isinstance(game_map, dict) else game_map,
        "length": int(d.get("game_length") or 0),
        "winner": next(iter(winners)) if len(winners) == 1 else None,
        "draft": draft,
        "xp": xp,
        "level": level,
        "players": [
            {
                "team": int(p["team"]),
                "hero": _hero_name(p.get("hero")),
                "win": 1 if p.get("winner") else 0,
                "party": parties.get((int(p["team"]), p.get("party")), 1) if p.get("party") else 1,
                "mmr": p.get("player_mmr"),
                "hero_mmr": p.get("hero_mmr"),
                "talents": [
                    ((p.get("talents") or {}).get(k) or {}).get("talent_name") for k in LEVEL_KEYS
                ],
                "score": {k: (p.get("score") or {}).get(k) for k in SCORE_KEYS},
            }
            for p in players
        ],
    }


@dataclass
class SampleResult:
    records: dict[str, list[dict[str, Any]]] = field(default_factory=lambda: {"sl": [], "qm": []})
    cursor: dict[str, int] = field(default_factory=dict)


def _of_patch(version: str, patch: str) -> bool:
    return version == patch or version.startswith(patch + ".")


async def _listing(
    c: HPClient, settings: Settings, kind: str, after: int | None
) -> tuple[list[tuple[int, str]], int | None]:
    """Replays of `kind` after `after`, oldest first, as (id, version), and the last id listed."""
    if after is None:
        first = await c.get_json("/replays", params={"game_type": kind, "mode": "json"})
        after = max(0, int(first.get("max_replay_id") or 0) - settings.replay_lookback_ids)
    found: list[tuple[int, str]] = []
    last = after
    for _ in range(MAX_PAGES):
        page = await c.get_json(
            "/replays", params={"game_type": kind, "after": str(last), "mode": "json"}
        )
        rows = page.get("replays") or []
        if not rows:
            break
        found.extend((int(r["replayID"]), str(r.get("game_version") or "")) for r in rows)
        last = int(page.get("next_after") or rows[-1]["replayID"])
    return found, last


def _spread(games: list[tuple[int, str]], cap: int) -> list[tuple[int, str]]:
    """At most `cap` games evenly spread over the list (in id order, so over the upload time)."""
    if len(games) <= cap:
        return games
    step = len(games) / cap
    return [games[int(i * step)] for i in range(cap)]


async def sample_replays(
    c: HPClient,
    settings: Settings,
    *,
    patch: str,
    cursor: dict[str, int],
    sleep: SleepFn,
    clock: Callable[[], float] = time.monotonic,
) -> SampleResult:
    """A sample of the games of `patch` uploaded since the cursor, per game type; the cursor moves
    to the last listed game (a sample: what the cap or the time budget leaves out is not chased)."""
    out = SampleResult(cursor=dict(cursor))
    deadline = clock() + settings.replay_minutes * 60
    for kind, cap in (("sl", settings.replay_sl_per_run), ("qm", settings.replay_qm_per_run)):
        if cap <= 0:
            continue
        listed, last = await _listing(c, settings, kind, cursor.get(kind))
        taken = _spread([(i, v) for i, v in listed if _of_patch(v, patch)], cap)
        for n, (replay_id, version) in enumerate(taken):
            if clock() > deadline:
                log.info("replays.time_budget", kind=kind, done=n)
                break
            if n:
                await sleep(settings.replay_call_spacing_seconds)
            try:
                d = await c.get_json(f"/replay/{replay_id}")
            except HPError as e:
                log.warning("replays.game_failed", id=replay_id, code=e.code, status=e.status)
                if e.code == "quota_exceeded":
                    break
                continue
            rec = compact(d, replay_id=replay_id, version=version) if isinstance(d, dict) else None
            if rec is not None:
                out.records[kind].append(rec)
        if last is not None:
            out.cursor[kind] = last
        log.info(
            "replays.sampled",
            kind=kind,
            listed=len(listed),
            games=len(out.records[kind]),
            cursor=out.cursor.get(kind),
        )
    return out


def load_cursor(data_dir: Path) -> dict[str, int]:
    p = data_dir / CURSOR_FILE
    if not p.exists():
        return {}
    raw = json.loads(p.read_text(encoding="utf-8"))
    return {k: int(v) for k, v in (raw.get("cursor") or {}).items()}


def save_cursor(data_dir: Path, cursor: dict[str, int], *, patch: str, collected_at: str) -> None:
    p = data_dir / CURSOR_FILE
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps({"patch": patch, "collected_at": collected_at, "cursor": cursor}, indent=1),
        encoding="utf-8",
    )

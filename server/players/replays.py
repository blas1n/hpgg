"""One game in full: GET /replay/{id} → both teams with every player's stat line.

HP bucket `replay_data` (1,000/week on Basic, 500 a minute). A game never changes, but it names
ten players, so the answer is cached no longer than `stale_max_seconds` (the purge in the privacy
poll drops it too), and every answer leaves out the players our privacy table holds — HP already
leaves out players who were private when we asked (API terms §5). Shape recorded 2026-10-01
(tests/server/fixtures/v1_replay_200.json).
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import structlog

from server.config import Settings
from server.players import quota
from server.players.hp import HPClient
from server.players.match_rows import HP_AWARDS, TALENT_LEVELS
from server.players.service import Outcome
from server.players.store import CacheEntry, HPStore

log = structlog.get_logger(__name__)

BUCKET = "replay_data"
REGIONS = {1: "NA", 2: "EU", 3: "KR", 5: "CN"}
MODES = {
    "Quick Match": "qm",
    "Storm League": "sl",
    "Unranked Draft": "ud",
    "ARAM": "ar",
    "Hero League": "hl",
    "Team League": "tl",
}
# our field → HP's field in a player's `score`
SCORE = {
    "level": "level",
    "kills": "kills",
    "deaths": "deaths",
    "assists": "assists",
    "takedowns": "takedowns",
    "hero_damage": "hero_damage",
    "siege_damage": "siege_damage",
    "structure_damage": "structure_damage",
    "healing": "healing",
    "self_healing": "self_healing",
    "damage_taken": "damage_taken",
    "experience": "experience_contribution",
    "time_spent_dead": "time_spent_dead",
    "time_cc": "time_cc_enemy_heroes",
    "merc_camps": "merc_camp_captures",
}


def replay_key(replay_id: int) -> str:
    return f"replay|{replay_id}"


@dataclass(frozen=True)
class ReplayLookup:
    outcome: Outcome
    replay: dict[str, Any] | None = None
    fetched_at: float | None = None
    retry_after: float | None = None


def _d(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _int(x: Any) -> int | None:
    return x if isinstance(x, int) and not isinstance(x, bool) else None


def _num(x: Any) -> float | None:
    return round(float(x), 2) if isinstance(x, int | float) and not isinstance(x, bool) else None


def _award(a: Any) -> str | None:
    if not isinstance(a, dict):
        return None
    key = HP_AWARDS.get(str(a.get("award_id")))
    if key is None:
        # add it to tools/hp_awards_seen.json and rerun tools/build_awards.py
        log.warning("replays.award_unknown", award_id=a.get("award_id"), title=a.get("title"))
    return key


def _player(p: dict[str, Any]) -> dict[str, Any] | None:
    hero = _d(p.get("hero"))
    if not hero.get("name"):
        return None
    score = _d(p.get("score"))
    talents = _d(p.get("talents"))
    return {
        "battletag": p.get("battletag") if isinstance(p.get("battletag"), str) else None,
        "hero": hero["name"],
        "short_name": hero.get("short_name"),
        "role": hero.get("new_role"),
        "party": p.get("party") if isinstance(p.get("party"), str) else None,
        "award": _award(p.get("match_award")),
        "mmr": _int(p.get("player_mmr")),
        "mmr_change": _num(p.get("player_change")),
        **{ours: _int(score.get(theirs)) for ours, theirs in SCORE.items()},
        "talents": [_d(talents.get(lvl)).get("talent_name") for lvl in TALENT_LEVELS],
    }


def normalize_replay(replay_id: int, body: dict[str, Any]) -> dict[str, Any]:
    winner = body.get("winner")
    teams = []
    for i, side in enumerate(body.get("players") or []):
        rows = [_player(_d(p)) for p in (side if isinstance(side, list) else [])]
        teams.append({"team": i, "win": winner == i, "players": [r for r in rows if r]})
    return {
        "replay_id": replay_id,
        "date": body.get("game_date"),
        "mode": MODES.get(str(body.get("game_type")), body.get("game_type")),
        "map": _d(body.get("game_map")).get("name"),
        "length_s": _int(body.get("game_length")),
        "region": REGIONS.get(body.get("region")),  # type: ignore[arg-type]
        "teams": teams,
    }


class ReplayService:
    def __init__(
        self, *, hp: HPClient, store: HPStore, settings: Settings, clock: Callable[[], float]
    ) -> None:
        self._hp = hp
        self._store = store
        self._settings = settings
        self._clock = clock
        self._inflight: dict[int, asyncio.Task[ReplayLookup]] = {}

    async def lookup(self, replay_id: int) -> ReplayLookup:
        entry = await self._store.get(replay_key(replay_id))
        if entry is not None and entry.expires_at > self._clock():
            return await self._shown(entry)
        task = self._inflight.get(replay_id)
        if task is None:
            task = asyncio.create_task(self._refresh(replay_id))
            self._inflight[replay_id] = task
            task.add_done_callback(lambda _t: self._inflight.pop(replay_id, None))
        return await asyncio.shield(task)

    async def status(self) -> dict[str, Any]:
        budget = self._settings.replay_daily_budget
        return {BUCKET: await quota.status(self._store, BUCKET, budget, self._clock())}

    async def _refresh(self, replay_id: int) -> ReplayLookup:
        s = self._settings
        now = self._clock()
        wait = await quota.blocked_for(
            self._store, BUCKET, floor=s.replay_quota_floor, budget=s.replay_daily_budget, now=now
        )
        if wait is not None:
            return ReplayLookup("quota_exceeded", retry_after=wait)
        up = await self._hp.get(f"/replay/{replay_id}", {})
        now = self._clock()
        exhausted = await quota.record(self._store, BUCKET, up, now)
        if up.status == 200 and isinstance(up.body, dict):
            await self._store.count_live_call(quota.day(now), BUCKET)
            game = normalize_replay(replay_id, up.body)
            entry = CacheEntry(replay_key(replay_id), 200, game, now, now + s.stale_max_seconds)
            await self._store.put(entry)
            return await self._shown(entry)
        if up.status == 404:
            return ReplayLookup("not_found")
        if exhausted is not None:
            return ReplayLookup("quota_exceeded", retry_after=exhausted)
        log.warning("replays.unavailable", status=up.status, code=up.code)
        return ReplayLookup("unavailable", retry_after=up.retry_after)

    async def _shown(self, e: CacheEntry) -> ReplayLookup:
        """The cached game without the players who went private since."""
        game = _d(e.body)
        region = game.get("region")
        teams = []
        for t in game.get("teams") or []:
            kept = []
            for p in _d(t).get("players") or []:
                tag = _d(p).get("battletag")
                if region and tag and await self._store.is_private(region, tag):
                    continue
                kept.append(p)
            teams.append({**_d(t), "players": kept})
        return ReplayLookup("ok", replay={**game, "teams": teams}, fetched_at=e.fetched_at)

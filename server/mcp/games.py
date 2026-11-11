"""The owner's Storm League games: refreshed from HP on use, kept in `owner_matches`, read back.

A refresh asks /players/matches?game_type=sl from page 1 until it meets a game it already has
(the first one takes every page), under the same guard as the site's match lists (bucket
`player_match_history`). Then each game without a shape gets one /replay/{id} under the
`replay_data` guard, `mcp_replay_interval_seconds` apart (HP allows 60 a minute). From the replay
only the game's shape is kept — length, heroes and roles per team, party sizes, bans, draft order,
team XP per minute — never another player's BattleTag or stat line (those are read per game,
`detail`). Observed fields keep HP's names; computed ones end in `_derived`; unknown is None.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections import Counter
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import structlog
from sqlalchemy import select

from server.config import Settings
from server.db import Database
from server.mcp.models import OwnerMatch, OwnerSync
from server.mcp.names import GameNames
from server.players import quota
from server.players.hp import HPClient, follow_job
from server.players.match_rows import TALENT_LEVELS
from server.players.replays import SCORE, ReplayService
from server.players.store import HPStore

log = structlog.get_logger(__name__)

LIST_BUCKET = "player_match_history"
REPLAY_BUCKET = "replay_data"
LEVELS = (1, 4, 7, 10, 13, 16, 20)
# the owner's stat line as HP's /players/matches names it (observed, copied as is)
STATS = (
    "level", "kills", "deaths", "assists", "takedowns", "highest_kill_streak", "hero_damage",
    "siege_damage", "structure_damage", "minion_damage", "creep_damage", "summon_damage",
    "healing", "self_healing", "damage_taken", "experience_contribution", "time_spent_dead",
    "merc_camp_captures", "watch_tower_captures", "town_kills", "regen_globes",
    "protection_allies", "stunning_enemies", "rooting_enemies", "silencing_enemies",
    "time_cc_enemy_heroes", "clutch_heals", "escapes", "vengeance", "outnumbered_deaths",
    "teamfight_escapes", "teamfight_healing", "teamfight_damage_taken", "teamfight_hero_damage",
    "multikill", "physical_damage", "spell_damage", "time_on_fire", "meta_experience",
)  # fmt: skip
RATING = ("player_mmr", "player_change", "hero_mmr", "hero_change", "role_mmr", "role_change")
LIMITS = [
    "Only games uploaded to Heroes Profile exist here; games never uploaded are missing.",
    "Storm League only (Quick Match, ARAM and others are not collected).",
    "Leaves, disconnects and abnormal endings are not recorded by HP.",
    "time_cc_enemy_heroes is 0 for every player in HP's data; use stunning_enemies, "
    "rooting_enemies and silencing_enemies instead.",
    "healing is null for heroes that cannot heal.",
    "Fields ending in _derived are computed here from observed fields; party_size_derived counts "
    "a missing HP party label as solo, which HP does not document.",
    "Dates are HP's game_date (timezone undocumented, appears to be UTC).",
]


def _d(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _int(x: Any) -> int | None:
    return x if isinstance(x, int) and not isinstance(x, bool) else None


def _num(x: Any) -> float | None:
    return float(x) if isinstance(x, int | float) and not isinstance(x, bool) else None


def _hero(x: Any) -> str | None:
    """HP sends hero 0 for an empty ban slot."""
    return _d(x).get("name") or None


def own_row(r: dict[str, Any]) -> dict[str, Any] | None:
    """One /players/matches row → the owner's row (observed fields only)."""
    if not isinstance(r.get("replayID"), int) or not _hero(r.get("hero")):
        return None
    hero = _d(r.get("hero"))
    return {
        "match_id": r["replayID"],
        "date": r.get("game_date"),
        "map": _d(r.get("game_map")).get("name"),
        "hero": hero["name"],
        "role": r.get("role") or hero.get("new_role"),
        "win": r.get("winner") in (1, True, "1"),
        "rating": {k: _num(r.get(k)) for k in RATING},
        "first_to_ten": None if r.get("first_to_ten") is None else r.get("first_to_ten") == 1,
        "award_id": None if r.get("match_award") is None else str(r["match_award"]),
        "stats": {k: _int(r.get(k)) for k in STATS},
        "talents": [
            {
                "level": lvl,
                "talent_key": _d(r.get(key)).get("talent_name"),
                "title_en": _d(r.get(key)).get("title"),
            }
            for key, lvl in zip(TALENT_LEVELS, LEVELS, strict=True)
        ],
    }


def game_shape(body: dict[str, Any], owner: str) -> dict[str, Any]:
    """One /replay/{id} answer → the game's shape, with no player identity in it."""
    hero_team: dict[str, int] = {}
    my_team: int | None = None
    teams: list[dict[str, Any]] = []
    for side in body.get("players") or []:
        players = (
            [_d(p) for p in side if _hero(_d(p).get("hero"))] if isinstance(side, list) else []
        )
        if not players:
            continue
        team = players[0].get("team")
        parties = Counter(p.get("party") for p in players if p.get("party"))
        heroes = []
        for p in players:
            name = _hero(p.get("hero"))
            assert name is not None
            hero_team[name] = int(team) if isinstance(team, int) else -1
            if p.get("battletag") == owner:
                my_team = team
            party = p.get("party")
            heroes.append(
                {
                    "hero": name,
                    "role": _d(p.get("hero")).get("new_role"),
                    "is_me": p.get("battletag") == owner,
                    "party_size_derived": parties[party] if party else 1,
                }
            )
        teams.append({"team": team, "win": body.get("winner") == team, "heroes": heroes})
    bans: dict[int, list[str | None]] = {}
    ban_team: dict[str, int] = {}
    for side in body.get("replay_bans") or []:
        for b in side if isinstance(side, list) else []:
            t, h = _d(b).get("team"), _hero(_d(b).get("hero"))
            if isinstance(t, int):
                bans.setdefault(t, []).append(h)
                if h:
                    ban_team[h] = t
    for t in teams:
        t["bans"] = bans.get(t["team"], [])
    events = []
    for d in sorted(
        (_d(x) for x in body.get("draft_order") or []), key=lambda x: x.get("pick_number", 0)
    ):
        kind = {"0": "ban", "1": "pick"}.get(str(d.get("type")), str(d.get("type")))
        h = _hero(d.get("hero"))
        team = (hero_team if kind == "pick" else ban_team).get(h) if h else None
        events.append({"pick_number": d.get("pick_number"), "type": kind, "hero": h, "team": team})
    xp = _d(body.get("experience_breakdown")).get("data")
    return {
        "game_length_s": _int(body.get("game_length")),
        "my_team": my_team,
        "teams": teams,
        "draft": events,
        "xp_timeline": xp if isinstance(xp, list) else None,
    }


def draft_derived(game: dict[str, Any] | None, hero: str) -> dict[str, Any]:
    out: dict[str, Any] = {
        "my_team_first_pick_derived": None,
        "my_pick_within_team_derived": None,
        "my_pick_overall_derived": None,
    }
    if not game or not game.get("draft"):
        return out
    picks = [e for e in game["draft"] if e["type"] == "pick" and e["hero"]]
    mine = next((e for e in picks if e["hero"] == hero), None)
    my_team = game.get("my_team")
    if picks and my_team is not None:
        out["my_team_first_pick_derived"] = picks[0]["team"] == my_team
    if mine is not None:
        out["my_pick_overall_derived"] = picks.index(mine) + 1
        ours = [e for e in picks if e["team"] == my_team]
        out["my_pick_within_team_derived"] = ours.index(mine) + 1
    return out


@dataclass(frozen=True)
class Game:
    """One stored game: the owner's row and the game's shape (None until fetched)."""

    row: dict[str, Any]
    game: dict[str, Any] | None
    game_missing: bool


class OwnerGames:
    def __init__(
        self,
        *,
        db: Database,
        hp: HPClient,
        store: HPStore,
        replays: ReplayService,
        names: GameNames,
        settings: Settings,
        clock: Callable[[], float],
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._db = db
        self._hp = hp
        self._store = store
        self._replays = replays
        self.names = names
        self._s = settings
        self._clock = clock
        self._sleep = sleep
        self._task: asyncio.Task[None] | None = None

    @property
    def owner(self) -> str:
        return self._s.mcp_owner_battletag

    # -- refresh ----------------------------------------------------------------------------

    async def ensure_fresh(self) -> None:
        """Start a refresh when the last one is older than the interval; wait for it a while."""
        if self._task is None or self._task.done():
            last = await self._sync_row()
            fresh = (
                last is not None
                and last.finished_at is not None
                and self._clock() - last.finished_at < self._s.mcp_sync_interval_seconds
            )
            if fresh:
                return
            self._task = asyncio.create_task(self._refresh())
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(asyncio.shield(self._task), self._s.mcp_sync_wait_seconds)

    async def close(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def _sync_row(self) -> OwnerSync | None:
        async with self._db.session() as s:
            return await s.get(OwnerSync, self.owner)

    async def _set_sync(self, **values: Any) -> None:
        async with self._db.session() as s, s.begin():
            row = await s.get(OwnerSync, self.owner)
            if row is None:
                row = OwnerSync(battletag=self.owner, started_at=self._clock())
                s.add(row)
            for k, v in values.items():
                setattr(row, k, v)

    async def _refresh(self) -> None:
        await self._set_sync(started_at=self._clock(), finished_at=None, result=None)
        result = "error"
        try:
            result = await self._pull_list()
            details = await self._pull_games()
            if result == "ok" and details != "ok":
                result = details
        except Exception:  # a refresh must never take a tool call down with it
            log.exception("mcp.sync_failed")
        finally:
            await self._set_sync(finished_at=self._clock(), result=result)
            log.info("mcp.sync", result=result)

    async def _pull_list(self) -> str:
        s = self._s
        for page in range(1, s.mcp_list_pages_max + 1):
            now = self._clock()
            wait = await quota.blocked_for(
                self._store,
                LIST_BUCKET,
                floor=s.match_quota_floor,
                budget=s.match_daily_budget,
                now=now,
            )
            if wait is not None:
                return "quota_exceeded"
            params = {
                "battletag": self.owner,
                "region": s.mcp_owner_region,
                "game_type": "sl",
                "pagination_page": str(page),
            }
            up = await self._hp.get("/players/matches", params)
            await quota.charge(self._store, LIST_BUCKET, up, self._clock())
            if up.status == 202:
                up = await follow_job(
                    self._hp, up, poll=s.hp_job_poll_seconds, wait=s.hp_job_wait_seconds,
                    sleep=self._sleep,
                )  # fmt: skip
            await quota.record(self._store, LIST_BUCKET, up, self._clock())
            if up.status != 200 or not isinstance(up.body, dict):
                log.warning("mcp.list_unavailable", status=up.status, code=up.code)
                return "upstream_unavailable"
            rows = [x for r in up.body.get("data") or [] if (x := own_row(_d(r)))]
            known = await self._store_rows(rows)
            last = up.body.get("last_page")
            if known or not rows or not isinstance(last, int) or page >= last:
                return "ok"
        return "ok"

    async def _store_rows(self, rows: list[dict[str, Any]]) -> bool:
        """Stores the new rows; True when one of them was already there."""
        now = self._clock()
        seen = False
        async with self._db.session() as s, s.begin():
            for r in rows:
                if await s.get(OwnerMatch, r["match_id"]) is not None:
                    seen = True
                    continue
                s.add(
                    OwnerMatch(
                        match_id=r["match_id"],
                        battletag=self.owner,
                        date=str(r["date"] or ""),
                        row=json.dumps(r, ensure_ascii=False),
                        game=None,
                        game_missing=False,
                        fetched_at=now,
                    )
                )
        return seen

    async def _pull_games(self) -> str:
        s = self._s
        async with self._db.session() as ses:
            ids = list(
                (
                    await ses.execute(
                        select(OwnerMatch.match_id)
                        .where(
                            OwnerMatch.battletag == self.owner,
                            OwnerMatch.game.is_(None),
                            OwnerMatch.game_missing.is_(False),
                        )
                        .order_by(OwnerMatch.date.desc())
                        .limit(s.mcp_replays_per_sync)
                    )
                ).scalars()
            )
        for i, match_id in enumerate(ids):
            if i:
                await self._sleep(s.mcp_replay_interval_seconds)
            now = self._clock()
            wait = await quota.blocked_for(
                self._store,
                REPLAY_BUCKET,
                floor=s.replay_quota_floor,
                budget=s.replay_daily_budget,
                now=now,
            )
            if wait is not None:
                return "replay_quota_exceeded"
            up = await self._hp.get(f"/replay/{match_id}", {})
            await quota.record(self._store, REPLAY_BUCKET, up, self._clock())
            if up.status == 200 and isinstance(up.body, dict):
                await self._store.count_live_call(quota.day(self._clock()), REPLAY_BUCKET)
                await self._set_game(match_id, game_shape(up.body, self.owner))
            elif up.status in (403, 404):
                await self._set_game(match_id, None)
            else:
                log.warning("mcp.replay_unavailable", status=up.status, code=up.code)
                return "replay_unavailable"
        return "ok"

    async def _set_game(self, match_id: int, game: dict[str, Any] | None) -> None:
        async with self._db.session() as s, s.begin():
            row = await s.get(OwnerMatch, match_id)
            if row is None:
                return
            if game is None:
                row.game_missing = True
            else:
                row.game = json.dumps(game, ensure_ascii=False)

    # -- reading ----------------------------------------------------------------------------

    async def all(self) -> list[Game]:
        """Every stored game, newest first."""
        async with self._db.session() as s:
            rows = (
                await s.execute(
                    select(OwnerMatch)
                    .where(OwnerMatch.battletag == self.owner)
                    .order_by(OwnerMatch.date.desc(), OwnerMatch.match_id.desc())
                )
            ).scalars()
            return [
                Game(json.loads(r.row), json.loads(r.game) if r.game else None, r.game_missing)
                for r in rows
            ]

    async def sync_status(self) -> dict[str, Any]:
        row = await self._sync_row()
        games = await self.all()
        return {
            "running": self._task is not None and not self._task.done(),
            "last_started": quota.iso(row.started_at) if row else None,
            "last_finished": quota.iso(row.finished_at) if row and row.finished_at else None,
            "last_result": row.result if row else None,
            "games_without_detail": sum(1 for g in games if g.game is None),
            "refresh_every_seconds": self._s.mcp_sync_interval_seconds,
        }

    def flat(self, g: Game) -> dict[str, Any]:
        """A stored game as one list row."""
        r, game = g.row, g.game
        mine = None
        ours: list[dict[str, Any]] = []
        theirs: list[dict[str, Any]] = []
        if game:
            for t in game["teams"]:
                if t["team"] == game.get("my_team"):
                    ours = [t]
                else:
                    theirs = [t]
            mine = next((h for t in ours for h in t["heroes"] if h["is_me"]), None)
        stats = r["stats"]
        return {
            "match_id": r["match_id"],
            "date": r["date"],
            "map": r["map"],
            "map_ko": self.names.map_ko(r["map"]),
            "hero": r["hero"],
            "hero_ko": self.names.hero_ko(r["hero"]),
            "role": r["role"],
            "win": r["win"],
            "game_length_s": game["game_length_s"] if game else None,
            "kills": stats.get("kills"),
            "deaths": stats.get("deaths"),
            "assists": stats.get("assists"),
            "first_to_ten": r["first_to_ten"],
            "party_size_derived": mine["party_size_derived"] if mine else None,
            **draft_derived(game, r["hero"]),
            "my_team_heroes": [h["hero"] for t in ours for h in t["heroes"]] if game else None,
            "enemy_heroes": [h["hero"] for t in theirs for h in t["heroes"]] if game else None,
            "my_team_bans": [b for t in ours for b in t["bans"]] if game else None,
            "enemy_bans": [b for t in theirs for b in t["bans"]] if game else None,
            "rating": r["rating"],
            "award_id": r["award_id"],
            "stats": stats,
            "talents": r["talents"],
            "detail": "ok" if game else ("missing_at_hp" if g.game_missing else "pending"),
        }

    async def detail(self, match_id: int) -> dict[str, Any] | None:
        """One game with all ten players (others as player_N), or None if it is not the owner's."""
        stored = next((g for g in await self.all() if g.row["match_id"] == match_id), None)
        if stored is None:
            return None
        out = self.flat(stored)
        out.pop("stats")
        looked = await self._replays.lookup(match_id)
        out["teams"] = None
        out["players_source"] = looked.outcome
        if looked.outcome == "ok" and looked.replay is not None:
            out["teams"] = self._teams(looked.replay, stored.game)
        out["draft"] = {"events": stored.game["draft"]} if stored.game else None
        out["xp_timeline"] = stored.game["xp_timeline"] if stored.game else None
        return out

    def _teams(self, replay: dict[str, Any], game: dict[str, Any] | None) -> list[dict[str, Any]]:
        bans = {t["team"]: t["bans"] for t in (game or {}).get("teams", [])}
        n = 0
        teams = []
        for t in replay.get("teams") or []:
            players = []
            for p in t.get("players") or []:
                me = p.get("battletag") == self.owner
                if not me:
                    n += 1
                players.append(
                    {
                        "player_id": "me" if me else f"player_{n}",
                        "is_me": me,
                        "hero": p.get("hero"),
                        "hero_ko": self.names.hero_ko(p.get("hero")),
                        "role": p.get("role"),
                        "party_label": p.get("party"),
                        "award": p.get("award"),
                        "rating": {
                            "player_mmr": p.get("mmr"),
                            "player_change": p.get("mmr_change"),
                        },
                        # HP's own stat names, as in the owner's rows (ReplayService renames them)
                        "stats": {hp: p.get(ours) for ours, hp in SCORE.items()},
                        "talents": [
                            {"level": lvl, "talent_key": key}
                            for lvl, key in zip(LEVELS, p.get("talents") or [], strict=False)
                        ],
                    }
                )
            teams.append(
                {
                    "team": t.get("team"),
                    "win": t.get("win"),
                    "bans": bans.get(t.get("team"), []),
                    "players": players,
                }
            )
        return teams

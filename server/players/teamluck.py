"""팀운 (#90, owner 2026-10-06): how strong the player's team was against the opponents.

Per game: the mean MMR of the player's whole team (the player too) minus the opponents', each
before the game. The player is in it because matchmaking balances whole teams: the four
teammates alone are weaker the better the player is, and a strong player read 극악 every week
(a 24-player sample, 2026-10-06; teammates-only gap vs the player's lead over them: r = −0.33).
The whole team against the opponents is the matchmaker's luck.

A replay answer carries the MMR after the game (`player_conservative_rating` and
`player_change` match the match list's after-each-game row, replay 65597227), so before =
mmr − mmr_change. Measured on the MMR after, a won game would make the winners look stronger and
팀운 would only restate the record. Performance (teammates' KDA, damage) is circular for the same
reason and is not used.

Over the newest `games` of a mode from the match list, one replay each (cached as one game in
full is, shared with the ▾ on a game card). Private players are left out of a replay answer: each
side needs three known players to count. When the Replays bucket is spent,
the answer has the games so far and says it is partial.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Any, Protocol

from server.players.replays import ReplayLookup

# 몇인분 (owner 2026-10-06): the page judges each teammate against the same hero's usual output
# (web/src/lib/carry.ts, data/carry_baselines.json); a game carries the team's output for it
CARRY_STATS = (
    "takedowns",
    "hero_damage",
    "siege_damage",
    "experience",
    "healing",
    "damage_taken",
    "stuns",
    "roots",
    "silences",
    "shields",
    "merc_camps",
    "towers",
    "time_spent_dead",
)


def _team(players: list[dict[str, Any]], me: str) -> list[dict[str, Any]]:
    return [
        {
            "hero": p.get("hero"),
            "role": p.get("role"),
            "me": (p.get("battletag") or "").casefold() == me,
            "stats": {s: p.get(s) or 0 for s in CARRY_STATS},
        }
        for p in players
    ]


# a game is good or bad luck beyond this many MMR points either way
GOOD = 50.0
MIN_KNOWN = 3
# "all" is the modes matched on MMR: ARAM and custom games are not (owner sample 2026-10-06)
MATCHMADE = {"qm", "sl", "ud", "hl", "tl"}


def _pre(p: dict[str, Any]) -> float | None:
    mmr, change = p.get("mmr"), p.get("mmr_change")
    if not isinstance(mmr, int | float) or not isinstance(change, int | float):
        return None
    return float(mmr) - float(change)


def game_gap(game: dict[str, Any], battletag: str) -> dict[str, Any] | None:
    """One game's team-minus-opponents MMR before it, or None if it cannot be told."""
    me = battletag.casefold()
    teams = game.get("teams") or []
    mine = next(
        (
            t
            for t in teams
            if any((p.get("battletag") or "").casefold() == me for p in t["players"])
        ),
        None,
    )
    if mine is None:
        return None
    ours = [v for p in mine["players"] if (v := _pre(p)) is not None]
    opps = [v for t in teams if t is not mine for p in t["players"] if (v := _pre(p)) is not None]
    if len(ours) < MIN_KNOWN or len(opps) < MIN_KNOWN:
        return None
    team, opp = statistics.fmean(ours), statistics.fmean(opps)
    hero = next(
        (p.get("hero") for p in mine["players"] if (p.get("battletag") or "").casefold() == me),
        None,
    )
    return {
        "replay_id": game.get("replay_id"),
        "date": game.get("date"),
        "mode": game.get("mode"),
        "hero": hero,
        "win": bool(mine.get("win")),
        "team_mmr": round(team, 1),
        "opp_mmr": round(opp, 1),
        "gap": round(team - opp, 1),
        "length_s": game.get("length_s"),
        "team": _team(mine["players"], me),
    }


def summarize(gaps: list[dict[str, Any]]) -> dict[str, Any]:
    def cell(rows: list[dict[str, Any]]) -> dict[str, int]:
        return {"games": len(rows), "wins": sum(1 for r in rows if r["win"])}

    return {
        "games": len(gaps),
        "gap_avg": round(statistics.fmean(g["gap"] for g in gaps), 1) if gaps else None,
        "good": cell([g for g in gaps if g["gap"] >= GOOD]),
        "bad": cell([g for g in gaps if g["gap"] <= -GOOD]),
        "even": cell([g for g in gaps if -GOOD < g["gap"] < GOOD]),
    }


class _Matches(Protocol):
    async def lookup(self, battletag: str, region: str) -> Any: ...


class _Replays(Protocol):
    async def lookup(self, replay_id: int) -> ReplayLookup: ...


@dataclass(frozen=True)
class TeamLuckLookup:
    outcome: str
    games: list[dict[str, Any]] = field(default_factory=list)
    summary: dict[str, Any] = field(default_factory=dict)
    partial: bool = False
    retry_after: float | None = None


class TeamLuckService:
    def __init__(self, *, matches: _Matches, replays: _Replays) -> None:
        self._matches = matches
        self._replays = replays

    async def lookup(self, battletag: str, region: str, *, mode: str, games: int) -> TeamLuckLookup:
        m = await self._matches.lookup(battletag, region)
        if m.outcome != "ok":
            return TeamLuckLookup(m.outcome, retry_after=getattr(m, "retry_after", None))
        ids = [
            int(r["replay_id"])
            for r in m.matches
            if r.get("replay_id")
            and (r.get("mode") in MATCHMADE if mode == "all" else r.get("mode") == mode)
        ][:games]
        rows: list[dict[str, Any]] = []
        partial = False
        for rid in ids:
            got = await self._replays.lookup(rid)
            if got.outcome == "quota_exceeded":
                partial = True
                break
            if got.outcome != "ok" or got.replay is None:
                continue
            if (g := game_gap(got.replay, battletag)) is not None:
                rows.append(g)
        return TeamLuckLookup("ok", games=rows, summary=summarize(rows), partial=partial)

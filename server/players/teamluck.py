"""팀운 (#90, owner 2026-10-06): how strong the player's teammates were against the opponents.

Per game: the mean MMR of the four teammates minus the mean of the five opponents, each before
the game. A replay answer carries the MMR after it (`player_conservative_rating` and
`player_change` match the match list's after-each-game row, replay 65597227), so before =
mmr − mmr_change. Measured on the MMR after, a won game would make the winners look stronger and
팀운 would only restate the record. Performance (teammates' KDA, damage) is circular for the same
reason and is not used.

Over the newest `games` of a mode from the match list, one replay each (cached as one game in
full is, shared with the ▾ on a game card). Private players are left out of a replay answer: a side
needs two known teammates and three known opponents to count. When the Replays bucket is spent,
the answer has the games so far and says it is partial.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Any, Protocol

from server.players.replays import ReplayLookup

# 몇인분 (owner 2026-10-06): five things every role does some of; "sustain" = healing + damage
# taken, so a tank's soaking and a healer's healing count as a damage dealer's damage does
CARRY_STATS = ("takedowns", "hero_damage", "siege_damage", "experience", "sustain")
TOP = 3


def _stat(p: dict[str, Any], s: str) -> float:
    if s == "sustain":
        return float((p.get("healing") or 0) + (p.get("damage_taken") or 0))
    return float(p.get(s) or 0)


def _top(team: list[dict[str, Any]], me: dict[str, Any]) -> float | None:
    ratios = []
    for s in CARRY_STATS:
        mean = sum(_stat(p, s) for p in team) / len(team)
        if mean > 0:
            ratios.append(_stat(me, s) / mean)
    return statistics.fmean(sorted(ratios)[-TOP:]) if ratios else None


def carry(team: list[dict[str, Any]], me: dict[str, Any]) -> float | None:
    """How many players' worth: the three of CARRY_STATS the player did most of against the team's
    mean, averaged, then against the team's mean of that — an average teammate is 1.0, and a tank
    or a healer counts by what they do (on 4,010 Storm League player-games the middle 90 % is
    0.76–1.35; 1.5 or more is 1.5 %)."""
    if not team:
        return None
    mine = _top(team, me)
    tops = [t for p in team if (t := _top(team, p)) is not None]
    if mine is None or not tops or statistics.fmean(tops) == 0:
        return None
    return round(mine / statistics.fmean(tops), 1)


# a game is good or bad luck beyond this many MMR points either way
GOOD = 50.0
MIN_MATES, MIN_OPPS = 2, 3


def _pre(p: dict[str, Any]) -> float | None:
    mmr, change = p.get("mmr"), p.get("mmr_change")
    if not isinstance(mmr, int | float) or not isinstance(change, int | float):
        return None
    return float(mmr) - float(change)


def game_gap(game: dict[str, Any], battletag: str) -> dict[str, Any] | None:
    """One game's teammates-minus-opponents MMR before it, or None if it cannot be told."""
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
    mates = [
        v
        for p in mine["players"]
        if (p.get("battletag") or "").casefold() != me and (v := _pre(p)) is not None
    ]
    opps = [v for t in teams if t is not mine for p in t["players"] if (v := _pre(p)) is not None]
    if len(mates) < MIN_MATES or len(opps) < MIN_OPPS:
        return None
    team, opp = statistics.fmean(mates), statistics.fmean(opps)
    player = next(p for p in mine["players"] if (p.get("battletag") or "").casefold() == me)
    hero = player.get("hero")
    return {
        "replay_id": game.get("replay_id"),
        "date": game.get("date"),
        "mode": game.get("mode"),
        "hero": hero,
        "win": bool(mine.get("win")),
        "team_mmr": round(team, 1),
        "opp_mmr": round(opp, 1),
        "gap": round(team - opp, 1),
        "carry": carry(mine["players"], player),
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
            if r.get("replay_id") and (mode == "all" or r.get("mode") == mode)
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

"""팀운 (#90, owner 2026-10-06: "미리 준비해두고"): per game, the mean MMR of the player's four
teammates minus the mean of the five opponents, before the game, over the newest games of a mode.

- The MMR a replay answer carries is after the game: `player_conservative_rating` and
  `player_change` match the match list's "after each game" row for the same replay (checked on
  tests/server/fixtures, replay 65597227). Before = mmr − mmr_change. With the MMR after, a won
  game would make the winners look stronger and 팀운 would restate the record.
- A side needs at least two known teammates or three known opponents (private players are left
  out of a replay answer); otherwise the game is not counted.
- One replay call per game not cached (the Replays bucket, shared with the weekly report's
  sampler); when the bucket is spent the answer is partial and says so.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from server.players.replays import ReplayLookup, normalize_replay
from server.players.teamluck import GOOD, TeamLuckService, game_gap, summarize

FIX = Path(__file__).parent / "fixtures"
RID = 65597227


def _game() -> dict[str, Any]:
    body = json.loads((FIX / "v1_replay_200.json").read_text(encoding="utf-8"))["body"]
    return normalize_replay(RID, body)


def _me(game: dict[str, Any]) -> str:
    return next(
        p["battletag"]
        for t in game["teams"]
        for p in t["players"]
        if p["battletag"].startswith("blAs1N#")
    )


def _pre(p: dict[str, Any]) -> float:
    return p["mmr"] - p["mmr_change"]


def test_a_games_gap_is_teammates_minus_opponents_before_the_game() -> None:
    game = _game()
    me = _me(game)
    mine = next(t for t in game["teams"] if any(p["battletag"] == me for p in t["players"]))
    theirs = next(t for t in game["teams"] if t is not mine)
    mates = [_pre(p) for p in mine["players"] if p["battletag"] != me]
    opps = [_pre(p) for p in theirs["players"]]
    g = game_gap(game, me)
    assert g is not None
    assert g["team_mmr"] == pytest.approx(sum(mates) / len(mates), abs=0.5)
    assert g["opp_mmr"] == pytest.approx(sum(opps) / len(opps), abs=0.5)
    assert g["gap"] == pytest.approx(g["team_mmr"] - g["opp_mmr"], abs=0.5)
    assert g["win"] is True and g["replay_id"] == RID


def test_the_player_is_found_whatever_the_case_of_the_tag() -> None:
    game = _game()
    assert game_gap(game, _me(game).upper()) is not None


def test_too_few_known_players_is_no_gap() -> None:
    game = _game()
    me = _me(game)
    for t in game["teams"]:
        if not any(p["battletag"] == me for p in t["players"]):
            t["players"] = t["players"][:2]  # three opponents went private
    assert game_gap(game, me) is None
    assert game_gap(game, "nobody#1234") is None


def test_the_summary_averages_the_gaps_and_splits_good_and_bad_games() -> None:
    gaps = [
        {"gap": 120.0, "win": True},
        {"gap": -80.0, "win": False},
        {"gap": 10.0, "win": True},
        {"gap": GOOD, "win": False},
    ]
    s = summarize(gaps)
    assert s["games"] == 4
    assert s["gap_avg"] == pytest.approx((120 - 80 + 10 + GOOD) / 4)
    assert s["good"] == {"games": 2, "wins": 1}
    assert s["bad"] == {"games": 1, "wins": 0}
    assert s["even"] == {"games": 1, "wins": 1}
    assert summarize([])["gap_avg"] is None


@dataclass
class FakeMatches:
    outcome: str = "ok"
    matches: list[dict[str, Any]] = field(default_factory=list)

    async def lookup(self, battletag: str, region: str) -> Any:
        @dataclass
        class R:
            outcome: str
            matches: list[dict[str, Any]]
            retry_after: float | None = None

        return R(self.outcome, self.matches)


@dataclass
class FakeReplays:
    game: dict[str, Any]
    spent_after: int = 99
    asked: list[int] = field(default_factory=list)

    async def lookup(self, replay_id: int) -> ReplayLookup:
        self.asked.append(replay_id)
        if len(self.asked) > self.spent_after:
            return ReplayLookup("quota_exceeded", retry_after=60.0)
        return ReplayLookup("ok", replay={**self.game, "replay_id": replay_id})


async def test_the_service_reads_the_newest_games_of_a_mode() -> None:
    game = _game()
    rows = [{"replay_id": i, "mode": "sl" if i % 2 else "qm"} for i in range(1, 30)]
    replays = FakeReplays(game)
    svc = TeamLuckService(matches=FakeMatches(matches=rows), replays=replays)  # type: ignore[arg-type]
    r = await svc.lookup(_me(game), "KR", mode="sl", games=5)
    assert r.outcome == "ok"
    assert replays.asked == [1, 3, 5, 7, 9]  # the newest five Storm League games, in list order
    assert r.summary["games"] == 5 and len(r.games) == 5
    assert r.partial is False


async def test_a_spent_bucket_gives_what_it_has_and_says_so() -> None:
    game = _game()
    rows = [{"replay_id": i, "mode": "sl"} for i in range(1, 11)]
    svc = TeamLuckService(
        matches=FakeMatches(matches=rows),
        replays=FakeReplays(game, spent_after=3),  # type: ignore[arg-type]
    )
    r = await svc.lookup(_me(game), "KR", mode="sl", games=10)
    assert r.outcome == "ok" and r.summary["games"] == 3 and r.partial is True


async def test_a_private_player_has_no_team_luck() -> None:
    svc = TeamLuckService(matches=FakeMatches(outcome="private"), replays=FakeReplays(_game()))  # type: ignore[arg-type]
    r = await svc.lookup("someone#1234", "KR", mode="sl", games=10)
    assert r.outcome == "private"

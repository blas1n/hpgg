"""팀 조합 (밴픽 roadmap stage 3): each team's Storm League record by how many healers,
front-liners (tank + bruiser) and ranged assassins it drafted — what the 밴픽 suggestions weigh a
team's needs with.

Counted like 게임 시간대별 승률 (collector/hero_length.py): from the archived per-game records of
the patch's window, afresh every run, each game once, both teams. Measured 2026-10-15 on 10,800
games: no healer 36.9% (179 teams), two healers 41.2% (352), no front-liner 35.6% (101), three
ranged 44.8% (774); a team without a tank but with a bruiser is not worse (49.7%, 2,163), hence
`front`. A team with a hero of no known role (a new hero before tools/build_assets.py) or not five
players is left out. The top count of each group holds every count above it.

Each team also counts under its exact make-up (`makeups`, the count of each MAKEUP_ROLES role,
"1-1-1-2-0-0" = tank, bruiser, healer, two ranged): how often players choose it. A rarer make-up
loses more even with its own win rate accounted for (owner 2026-10-15: people do it for a reason;
measured out of sample on 10,800 games, about -1%p for a make-up chosen 10 times less often).

Output (data/latest/sl_comps.json, served as /latest/sl_comps.json):
  {patch, since, collected_at, games, teams,
   groups: {healer: {"0": {games, wins}, "1": …, "2": …}, front: {"0" … "3"}, ranged: {"0" … "3"}},
   makeups: {"1-1-1-2-0-0": {games, wins}, …}}
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from collector.hero_length import in_window
from collector.snapshot import patch_line

GROUPS: dict[str, tuple[str, ...]] = {
    "healer": ("Healer",),
    "front": ("Tank", "Bruiser"),
    "ranged": ("Ranged Assassin",),
}
CAPS: dict[str, int] = {"healer": 2, "front": 3, "ranged": 3}
MAKEUP_ROLES: tuple[str, ...] = (
    "Tank",
    "Bruiser",
    "Healer",
    "Ranged Assassin",
    "Melee Assassin",
    "Support",
)
TEAM_SIZE = 5


def makeup_key(team_roles: Iterable[str | None]) -> str:
    rs = list(team_roles)
    return "-".join(str(rs.count(r)) for r in MAKEUP_ROLES)


def comp_counts(
    games: Iterable[dict[str, Any]],
    roles: Mapping[str, str],
    *,
    patch: str,
    since: str | None,
    collected_at: str | None = None,
) -> dict[str, Any]:
    groups = {g: {str(n): {"games": 0, "wins": 0} for n in range(CAPS[g] + 1)} for g in GROUPS}
    makeups: dict[str, dict[str, int]] = {}
    seen: set[int] = set()
    teams = 0
    for game in games:
        if game["id"] in seen or not in_window(str(game.get("version") or ""), patch, since):
            continue
        seen.add(game["id"])
        for team in (0, 1):
            players = [p for p in game["players"] if p["team"] == team]
            team_roles = [roles.get(p["hero"]) for p in players]
            if len(players) != TEAM_SIZE or None in team_roles:
                continue
            teams += 1
            win = 1 if players[0]["win"] else 0
            for g, members in GROUPS.items():
                n = min(sum(r in members for r in team_roles), CAPS[g])
                cell = groups[g][str(n)]
                cell["games"] += 1
                cell["wins"] += win
            m = makeups.setdefault(makeup_key(team_roles), {"games": 0, "wins": 0})
            m["games"] += 1
            m["wins"] += win
    return {
        "patch": patch,
        "since": since if since and patch_line(since) == patch else None,
        "collected_at": collected_at,
        "games": len(seen),
        "teams": teams,
        "groups": groups,
        "makeups": dict(sorted(makeups.items())),
    }

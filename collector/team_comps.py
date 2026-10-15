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

Played roles (owner 2026-10-15: 블레이즈 goes bruiser, 바리안 tanks with 도발 …; from data, not
a list): `played_roles` reads each hero's teams — the official roles of the other four — as a
mix of what its own role and another role usually have around them (each role's usual teams
without the hero). A hero whose share of another role is at least `min_share` at the 95 % lower
bound plays both. 2026-10-15: 사무로 46 %, 머키 43 %, 블레이즈 41 %, 일리단 40 % and 길 잃은
바이킹 60 % as bruisers, 바리안 54 % as a tank (its 도발 games), 알라라크 45 %, 마이에브 39 %,
키히라 28 % in a ranged assassin's place, 자가라 43 % in a melee's. 초갈 is left out: one hero
of two players, each always next to the other. In the counts such a hero takes whichever of its
two roles makes its team the commoner make-up (official roles counted first), so a 블레이즈 next
to another tank and no bruiser is the bruiser. Out of sample (two halves, each judged on the
other's counts) the composition model predicts better with played roles: deviance gain 32.6
against 21.4 with official roles (30.0 with front-liners only).

Output (data/latest/sl_comps.json, served as /latest/sl_comps.json):
  {patch, since, collected_at, games, teams,
   groups: {healer: {"0": {games, wins}, "1": …, "2": …}, front: {"0" … "3"}, ranged: {"0" … "3"}},
   makeups: {"1-1-1-2-0-0": {games, wins}, …},
   played: {hero: {second, share, low, games}}}
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from itertools import product
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
ONE_HERO = frozenset({"Cho", "Gall"})


def makeup_key(team_roles: Iterable[str | None]) -> str:
    rs = list(team_roles)
    return "-".join(str(rs.count(r)) for r in MAKEUP_ROLES)


def _teams(
    games: Iterable[dict[str, Any]], roles: Mapping[str, str]
) -> list[tuple[list[str], int]]:
    """Each five-player team of known roles: (heroes, win)."""
    out = []
    for game in games:
        for team in (0, 1):
            players = [p for p in game["players"] if p["team"] == team]
            if len(players) == TEAM_SIZE and all(p["hero"] in roles for p in players):
                out.append(([p["hero"] for p in players], 1 if players[0]["win"] else 0))
    return out


def _others(heroes: list[str], i: int, roles: Mapping[str, str]) -> list[float]:
    rest = [roles[h] for j, h in enumerate(heroes) if j != i]
    return [float(rest.count(r)) for r in MAKEUP_ROLES]


def played_roles(
    games: Iterable[dict[str, Any]],
    roles: Mapping[str, str],
    *,
    min_games: int = 100,
    min_share: float = 0.2,
) -> dict[str, dict[str, Any]]:
    teams = _teams(games, roles)
    around: dict[str, list[list[float]]] = {}
    for heroes, _ in teams:
        for i, h in enumerate(heroes):
            around.setdefault(h, []).append(_others(heroes, i, roles))
    sums = {h: [sum(c) for c in zip(*vs, strict=True)] for h, vs in around.items()}

    def usual(role: str, without: str) -> list[float] | None:
        hs = [h for h in around if roles[h] == role and h != without]
        n = sum(len(around[h]) for h in hs)
        if not n:
            return None
        return [sum(sums[h][k] for h in hs) / n for k in range(len(MAKEUP_ROLES))]

    out: dict[str, dict[str, Any]] = {}
    for h, vs in around.items():
        # Cho and Gall are one hero of two players: each always has the other around it
        if len(vs) < min_games or h in ONE_HERO:
            continue
        a = usual(roles[h], h)
        if a is None:
            continue
        best: dict[str, Any] | None = None
        for other in MAKEUP_ROLES:
            b = usual(other, h) if other != roles[h] else None
            if b is None:
                continue
            d = [y - x for x, y in zip(a, b, strict=True)]
            dd = sum(x * x for x in d)
            if dd == 0:
                continue
            # each team's position between the two usual teams; their mean is the share
            al = [sum((v - x) * y for v, x, y in zip(vec, a, d, strict=True)) / dd for vec in vs]
            mean = sum(al) / len(al)
            sd = math.sqrt(sum((x - mean) ** 2 for x in al) / max(1, len(al) - 1))
            low = mean - 1.96 * sd / math.sqrt(len(al))
            if best is None or low > best["low"]:
                best = {"second": other, "share": round(mean, 4), "low": round(low, 4)}
        if best and best["low"] >= min_share:
            out[h] = {**best, "games": len(vs)}
    return dict(sorted(out.items()))


def _assign(
    heroes: list[str],
    roles: Mapping[str, str],
    played: Mapping[str, dict[str, Any]],
    official: Mapping[str, int],
) -> list[str]:
    """Each flex hero in the role that makes the team the commoner make-up (official on a tie)."""
    options = [[roles[h], played[h]["second"]] if h in played else [roles[h]] for h in heroes]
    best = [roles[h] for h in heroes]
    best_n = official.get(makeup_key(best), 0)
    for choice in product(*options):
        n = official.get(makeup_key(choice), 0)
        if n > best_n:
            best, best_n = list(choice), n
    return best


def comp_counts(
    games: Iterable[dict[str, Any]],
    roles: Mapping[str, str],
    *,
    patch: str,
    since: str | None,
    collected_at: str | None = None,
    min_flex_games: int = 100,
) -> dict[str, Any]:
    groups = {g: {str(n): {"games": 0, "wins": 0} for n in range(CAPS[g] + 1)} for g in GROUPS}
    window: list[dict[str, Any]] = []
    seen: set[int] = set()
    for game in games:
        if game["id"] in seen or not in_window(str(game.get("version") or ""), patch, since):
            continue
        seen.add(game["id"])
        window.append(game)
    teams = _teams(window, roles)
    official: dict[str, int] = {}
    for heroes, _ in teams:
        k = makeup_key(roles[h] for h in heroes)
        official[k] = official.get(k, 0) + 1
    played = played_roles(window, roles, min_games=min_flex_games)
    makeups: dict[str, dict[str, int]] = {}
    for heroes, win in teams:
        team_roles = _assign(heroes, roles, played, official)
        for g, members in GROUPS.items():
            n = min(sum(r in members for r in team_roles), CAPS[g])
            cell = groups[g][str(n)]
            cell["games"] += 1
            cell["wins"] += win
        m = makeups.setdefault(makeup_key(team_roles), {"games": 0, "wins": 0})
        m["games"] += 1
        m["wins"] += win
    teams_n = len(teams)
    return {
        "patch": patch,
        "since": since if since and patch_line(since) == patch else None,
        "collected_at": collected_at,
        "games": len(seen),
        "teams": teams_n,
        "groups": groups,
        "makeups": dict(sorted(makeups.items())),
        "played": played,
    }

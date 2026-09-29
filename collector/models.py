"""Internal data shapes (dataclasses, not dicts)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class HeroStat:
    hero: str
    map: str
    wins: int
    losses: int
    games: int
    bans: int
    pick: float
    popularity: float
    win_rate: float
    ban_rate: float
    ci: float | None = None


@dataclass(frozen=True)
class JobSpec:
    key: str
    game_type: str
    league_tier: tuple[int, ...] | None
    filename: str
    region: str | None = None  # HP region code (KR, NA, EU); None = every region
    groupsize: str | None = None  # HP party size of the hero's player ("Solo"); None = all games


@dataclass
class ModeSnapshot:
    patch: str
    key: str
    game_type: str
    league_tier: tuple[int, ...] | None
    collected_at: str
    matches: int
    rows: list[HeroStat] = field(default_factory=list)
    region: str | None = None

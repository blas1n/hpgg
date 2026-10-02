"""GET /v1/players?battletag=Name%231234&region=KR — one player's profile; /matches — games;
/heroes — stats per hero (?mode=all|qm|sl)."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from server.errors import error
from server.players.heroes import HeroMode, HeroStatsService
from server.players.matches import MatchService
from server.players.service import Outcome, PlayerService
from server.ratelimit import SlidingWindowLimiter, client_ip

router = APIRouter(prefix="/v1/players", tags=["players"])

# BattleTag: a name without spaces or '#', then '#' and the discriminator digits.
BATTLETAG = r"^[^\s#]{1,24}#\d{3,8}$"


class Region(StrEnum):
    KR = "KR"
    NA = "NA"
    EU = "EU"
    CN = "CN"


class PlayerQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    battletag: str = Field(pattern=BATTLETAG, max_length=40)
    region: Region


class HeroesQuery(PlayerQuery):
    mode: HeroMode = "all"


def _iso(ts: float | None) -> str | None:
    return None if ts is None else datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def rate_limited(request: Request) -> JSONResponse | None:
    ip = client_ip(request)
    minute: SlidingWindowLimiter = request.app.state.ip_limiter
    if (wait := minute.hit(ip)) is not None:
        return error(429, "rate_limited", "요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", wait)
    day: SlidingWindowLimiter = request.app.state.ip_day_limiter
    if (wait := day.hit(ip)) is not None:
        msg = "오늘 이 주소의 조회가 너무 많습니다. 내일 다시 시도하세요."
        return error(429, "rate_limited", msg, wait)
    return None


def _failure(outcome: Outcome, retry_after: float | None) -> JSONResponse | None:
    if outcome == "not_found":
        return error(404, "player_not_found", "해당 지역에서 플레이어를 찾지 못했습니다.")
    if outcome == "private":
        return error(403, "player_private", "비공개 프로필입니다.")
    if outcome == "quota_exceeded":
        return error(429, "quota_exceeded", "오늘 조회 한도를 모두 썼습니다.", retry_after)
    if outcome == "unavailable":
        return error(503, "upstream_unavailable", "전적 서버가 응답하지 않습니다.", retry_after)
    return None


@router.get("")
async def get_player(request: Request, q: Annotated[PlayerQuery, Query()]) -> JSONResponse:
    if (limited := rate_limited(request)) is not None:
        return limited
    service: PlayerService = request.app.state.players
    r = await service.lookup(q.battletag, q.region.value)
    if (failed := _failure(r.outcome, r.retry_after)) is not None:
        return failed
    body: dict[str, Any] = {
        "player": r.profile,
        "fetched_at": _iso(r.fetched_at),
        "stale": r.stale,
        "notice": r.notice,
    }
    return JSONResponse(body, headers={"Cache-Control": "public, max-age=300"})


@router.get("/matches")
async def get_matches(request: Request, q: Annotated[PlayerQuery, Query()]) -> JSONResponse:
    if (limited := rate_limited(request)) is not None:
        return limited
    service: MatchService = request.app.state.matches
    r = await service.lookup(q.battletag, q.region.value)
    if (failed := _failure(r.outcome, r.retry_after)) is not None:
        return failed
    body: dict[str, Any] = {
        "source": r.source,
        "matches": r.matches,
        "fetched_at": _iso(r.fetched_at),
        "stale": r.stale,
        "notice": r.notice,
    }
    return JSONResponse(body, headers={"Cache-Control": "public, max-age=300"})


@router.get("/heroes")
async def get_heroes(request: Request, q: Annotated[HeroesQuery, Query()]) -> JSONResponse:
    if (limited := rate_limited(request)) is not None:
        return limited
    service: HeroStatsService = request.app.state.heroes
    r = await service.lookup(q.battletag, q.region.value, q.mode)
    if (failed := _failure(r.outcome, r.retry_after)) is not None:
        return failed
    body: dict[str, Any] = {
        "mode": q.mode,
        "heroes": r.heroes,
        "fetched_at": _iso(r.fetched_at),
        "stale": r.stale,
        "notice": r.notice,
    }
    return JSONResponse(body, headers={"Cache-Control": "public, max-age=300"})

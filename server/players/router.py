"""GET /v1/players?battletag=Name%231234&region=KR — one player's profile."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from server.errors import error
from server.players.service import PlayerService
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


def _iso(ts: float | None) -> str | None:
    return None if ts is None else datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("")
async def get_player(request: Request, q: Annotated[PlayerQuery, Query()]) -> JSONResponse:
    limiter: SlidingWindowLimiter = request.app.state.ip_limiter
    wait = limiter.hit(client_ip(request))
    if wait is not None:
        return error(429, "rate_limited", "요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", wait)

    service: PlayerService = request.app.state.players
    r = await service.lookup(q.battletag, q.region.value)
    if r.outcome == "not_found":
        return error(404, "player_not_found", "해당 지역에서 플레이어를 찾지 못했습니다.")
    if r.outcome == "private":
        return error(403, "player_private", "비공개 프로필입니다.")
    if r.outcome == "quota_exceeded":
        return error(429, "quota_exceeded", "오늘 조회 한도를 모두 썼습니다.", r.retry_after)
    if r.outcome == "unavailable":
        return error(503, "upstream_unavailable", "전적 서버가 응답하지 않습니다.", r.retry_after)
    body: dict[str, Any] = {
        "player": r.profile,
        "fetched_at": _iso(r.fetched_at),
        "stale": r.stale,
        "notice": r.notice,
    }
    return JSONResponse(body, headers={"Cache-Control": "public, max-age=300"})

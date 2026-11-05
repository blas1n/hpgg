"""GET /v1/heroes/talents?hero=Hanzo&map=Battlefield%20of%20Eternity&tier=all&patch=2.57.0 — a
hero's talent tree on one map (server/heroes/talents.py)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from server.errors import error
from server.heroes.talents import TalentService
from server.players.router import rate_limited

router = APIRouter(prefix="/v1/heroes", tags=["heroes"])

# The site's maps (data/maps_ko.json) as HP names them: anything else spends a call on nothing.
MapName = Literal[
    "Alterac Pass",
    "Battlefield of Eternity",
    "Blackheart's Bay",
    "Braxis Holdout",
    "Cursed Hollow",
    "Dragon Shire",
    "Garden of Terror",
    "Hanamura Temple",
    "Haunted Mines",
    "Infernal Shrines",
    "Sky Temple",
    "Tomb of the Spider Queen",
    "Towers of Doom",
    "Volskaya Foundry",
    "Warhead Junction",
]
# HP's hero names: letters (Lúcio), spaces, dots, apostrophes and hyphens (Lt. Morales, Xal'atath)
HERO = r"^[^\W\d_][\w .'\-]{0,29}$"


class TalentQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hero: str = Field(pattern=HERO, max_length=30)
    map: MapName
    tier: Literal["all", "high", "low"] = "all"
    patch: str = Field(pattern=r"^\d{1,2}\.\d{1,3}\.\d{1,3}$")


def _iso(ts: float | None) -> str | None:
    return None if ts is None else datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/talents")
async def get_talents(request: Request, q: Annotated[TalentQuery, Query()]) -> JSONResponse:
    if (limited := rate_limited(request)) is not None:
        return limited
    service: TalentService = request.app.state.talents
    r = await service.lookup(q.hero, q.map, q.tier, q.patch)
    if r.outcome == "not_found":
        return error(404, "hero_not_found", "영웅을 찾지 못했습니다.")
    if r.outcome == "unknown_patch":
        return error(404, "patch_not_found", "패치를 찾지 못했습니다.")
    if r.outcome == "quota_exceeded":
        return error(429, "quota_exceeded", "오늘 조회 한도를 모두 썼습니다.", r.retry_after)
    if r.outcome != "ok":
        return error(503, "upstream_unavailable", "통계 서버가 응답하지 않습니다.", r.retry_after)
    body: dict[str, Any] = {
        "hero": q.hero,
        "map": q.map,
        "tier": q.tier,
        "patch": q.patch,
        "builds": r.builds,
        "levels": r.levels,
        "fetched_at": _iso(r.fetched_at),
        "stale": r.stale,
        "notice": r.notice,
    }
    return JSONResponse(body, headers={"Cache-Control": "public, max-age=3600"})

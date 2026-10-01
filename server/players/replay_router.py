"""GET /v1/replays/{replay_id} — one game in full (server/players/replays.py)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Path, Request
from fastapi.responses import JSONResponse

from server.errors import error
from server.players.replays import ReplayService
from server.players.router import rate_limited

router = APIRouter(prefix="/v1/replays", tags=["replays"])


@router.get("/{replay_id}")
async def get_replay(
    request: Request, replay_id: Annotated[int, Path(ge=1, le=9_999_999_999)]
) -> JSONResponse:
    if (limited := rate_limited(request)) is not None:
        return limited
    service: ReplayService = request.app.state.replays
    r = await service.lookup(replay_id)
    if r.outcome == "not_found":
        return error(404, "replay_not_found", "경기를 찾지 못했습니다.")
    if r.outcome == "quota_exceeded":
        return error(429, "quota_exceeded", "오늘 조회 한도를 모두 썼습니다.", r.retry_after)
    if r.outcome != "ok":
        return error(503, "upstream_unavailable", "전적 서버가 응답하지 않습니다.", r.retry_after)
    fetched = None if r.fetched_at is None else datetime.fromtimestamp(r.fetched_at, UTC)
    body: dict[str, Any] = {
        "replay": r.replay,
        "fetched_at": fetched.strftime("%Y-%m-%dT%H:%M:%SZ") if fetched else None,
    }
    return JSONResponse(body, headers={"Cache-Control": "public, max-age=300"})

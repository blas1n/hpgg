"""GET /v1/comments?thread=… · POST /v1/comments
POST /v1/comments/{id}/delete · POST /v1/comments/{id}/report"""

from __future__ import annotations

from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Path, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from server.comments.service import THREAD, CommentService, valid_body, valid_nickname
from server.errors import error
from server.ratelimit import SlidingWindowLimiter, client_ip

router = APIRouter(prefix="/v1/comments", tags=["comments"])
ID = Annotated[int, Path(ge=1, le=2**31)]


class NewComment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    thread: str = Field(pattern=THREAD.pattern, max_length=60)
    nickname: str = Field(max_length=40)
    password: str = Field(min_length=4, max_length=64)
    body: str = Field(max_length=2000)
    # a field people never see: a bot fills it
    website: str = Field(default="", max_length=0)

    _nick = field_validator("nickname")(valid_nickname)
    _body = field_validator("body")(valid_body)


class Password(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=64)


def _service(request: Request) -> CommentService:
    s: CommentService = request.app.state.comments
    return s


def _limited(request: Request, *names: str) -> JSONResponse | None:
    ip = client_ip(request)
    for name in names:
        limiter: SlidingWindowLimiter = getattr(request.app.state, name)
        if (wait := limiter.hit(ip)) is not None:
            return error(429, "rate_limited", "잠시 후 다시 시도하세요.", wait)
    return None


@router.get("")
async def list_comments(
    request: Request, thread: Annotated[str, Query(pattern=THREAD.pattern, max_length=60)]
) -> JSONResponse:
    if (limited := _limited(request, "comment_read_limiter")) is not None:
        return limited
    rows = await _service(request).list(thread)
    return JSONResponse(
        {"count": len(rows), "comments": [asdict(r) for r in rows]},
        headers={"Cache-Control": "no-store"},
    )


@router.post("")
async def post_comment(request: Request, c: NewComment) -> JSONResponse:
    if (limited := _limited(request, "comment_post_limiter", "comment_day_limiter")) is not None:
        return limited
    row = await _service(request).post(
        thread=c.thread,
        nickname=c.nickname,
        password=c.password,
        body=c.body,
        ip=client_ip(request),
    )
    return JSONResponse(asdict(row), status_code=201)


@router.post("/{comment_id}/delete")
async def delete_comment(request: Request, comment_id: ID, p: Password) -> Response:
    if (limited := _limited(request, "comment_read_limiter")) is not None:
        return limited
    done = await _service(request).delete(comment_id, p.password)
    if done is None:
        return error(404, "comment_not_found", "댓글이 없습니다.")
    if done is False:
        return error(403, "wrong_password", "비밀번호가 다릅니다.")
    return Response(status_code=204)


@router.post("/{comment_id}/report")
async def report_comment(request: Request, comment_id: ID) -> Response:
    if (limited := _limited(request, "comment_report_limiter")) is not None:
        return limited
    if not await _service(request).report(comment_id, client_ip(request)):
        return error(404, "comment_not_found", "댓글이 없습니다.")
    return Response(status_code=204)

"""GET /v1/auth/battlenet/login · GET /v1/auth/battlenet/callback · POST /v1/auth/logout
GET /v1/me · POST /v1/me/region · DELETE /v1/me

The session is an HttpOnly, Secure, SameSite=Lax cookie on api.hpgg.win; the site calls with
`credentials: "include"`. Changes (logout, region, delete) also check the Origin header against
the site's origins, on top of SameSite and the JSON preflight.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Cookie, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, ConfigDict

from server.accounts.service import AccountService, Me
from server.errors import error
from server.ratelimit import SlidingWindowLimiter, client_ip

router = APIRouter(tags=["accounts"])

SESSION_COOKIE = "hpgg_session"
STATE_COOKIE = "hpgg_oauth_state"
STATE_PATH = "/v1/auth"


class RegionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    region: Literal["KR", "NA", "EU"]


def _service(request: Request) -> AccountService:
    s: AccountService = request.app.state.accounts
    return s


def _limited(request: Request) -> JSONResponse | None:
    limiter: SlidingWindowLimiter = request.app.state.ip_limiter
    if (wait := limiter.hit(client_ip(request))) is not None:
        return error(429, "rate_limited", "잠시 후 다시 시도하세요.", wait)
    return None


def _foreign_origin(request: Request) -> JSONResponse | None:
    origin = request.headers.get("origin")
    if origin is not None and origin not in request.app.state.settings.cors_origins:
        return error(403, "forbidden_origin", "허용되지 않은 출처입니다.")
    return None


async def _me(request: Request, token: str | None) -> Me | None:
    return await _service(request).me(token)


def _unauthorized() -> JSONResponse:
    return error(401, "not_signed_in", "로그인이 필요합니다.")


@router.get("/v1/auth/battlenet/login")
async def login(
    request: Request, next: Annotated[str | None, Query(max_length=512)] = None
) -> Response:
    if not _service(request).enabled:
        return error(503, "accounts_disabled", "로그인을 준비 중입니다.")
    if (limited := _limited(request)) is not None:
        return limited
    started = await _service(request).start(next)
    r = RedirectResponse(started.url, status_code=302, headers={"Cache-Control": "no-store"})
    r.set_cookie(
        STATE_COOKIE,
        started.state,
        max_age=request.app.state.settings.oauth_state_ttl_seconds,
        path=STATE_PATH,
        secure=True,
        httponly=True,
        samesite="lax",
    )
    return r


@router.get("/v1/auth/battlenet/callback")
async def callback(
    request: Request,
    code: Annotated[str | None, Query(max_length=2048)] = None,
    state: Annotated[str | None, Query(max_length=256)] = None,
    error_: Annotated[str | None, Query(alias="error", max_length=256)] = None,
    browser_state: Annotated[str | None, Cookie(alias=STATE_COOKIE)] = None,
) -> Response:
    settings = request.app.state.settings
    result = await _service(request).finish(
        state=state, browser_state=browser_state, code=code, error=error_
    )
    target = settings.site_url + result.next_path
    if result.outcome != "ok":
        target += ("&" if "?" in result.next_path else "?") + f"login={result.outcome}"
    r = RedirectResponse(target, status_code=302, headers={"Cache-Control": "no-store"})
    r.delete_cookie(STATE_COOKIE, path=STATE_PATH, secure=True, httponly=True, samesite="lax")
    if result.session_token is not None:
        r.set_cookie(
            SESSION_COOKIE,
            result.session_token,
            max_age=settings.session_ttl_seconds,
            path="/",
            secure=True,
            httponly=True,
            samesite="lax",
        )
    return r


@router.get("/v1/me")
async def me(
    request: Request, session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None
) -> JSONResponse:
    m = await _me(request, session)
    if m is None:
        return _unauthorized()
    return JSONResponse(
        {"battletag": m.battletag, "region": m.region}, headers={"Cache-Control": "no-store"}
    )


@router.post("/v1/me/region")
async def set_region(
    request: Request,
    body: RegionIn,
    session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> Response:
    if (foreign := _foreign_origin(request)) is not None:
        return foreign
    m = await _me(request, session)
    if m is None:
        return _unauthorized()
    await _service(request).set_region(m.account_id, body.region)
    return Response(status_code=204)


@router.post("/v1/auth/logout")
async def logout(
    request: Request, session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None
) -> Response:
    if (foreign := _foreign_origin(request)) is not None:
        return foreign
    if session:
        await _service(request).logout(session)
    r = Response(status_code=204)
    r.delete_cookie(SESSION_COOKIE, path="/", secure=True, httponly=True, samesite="lax")
    return r


@router.delete("/v1/me")
async def delete_me(
    request: Request, session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None
) -> Response:
    if (foreign := _foreign_origin(request)) is not None:
        return foreign
    m = await _me(request, session)
    if m is None:
        return _unauthorized()
    await _service(request).delete_account(m.account_id)
    r = Response(status_code=204)
    r.delete_cookie(SESSION_COOKIE, path="/", secure=True, httponly=True, samesite="lax")
    return r

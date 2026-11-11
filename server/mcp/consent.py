"""GET /mcp/consent?req=… · POST /mcp/consent — the page between ChatGPT's /authorize and its code.

Signed out → Battle.net sign-in, which comes back here. Signed in as anyone but the owner → the
client gets access_denied. The owner sees which client asks and where the code will go, and must
press allow: an automatic yes would hand the owner's token to anyone who registers their own
ChatGPT connector and gets the owner to open its authorize link. Allow is a POST, which the
SameSite=Lax session cookie does not ride on from another site, and its Origin is checked too.
"""

from __future__ import annotations

from html import escape
from typing import Annotated
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, Cookie, Form, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from server.accounts.router import SESSION_COOKIE
from server.accounts.service import AccountService, Me
from server.config import Settings
from server.errors import error
from server.mcp.oauth import OwnerOAuthProvider

router = APIRouter(tags=["mcp"])
PATH = "/mcp/consent"


def _provider(request: Request) -> OwnerOAuthProvider:
    p: OwnerOAuthProvider = request.app.state.mcp_oauth
    return p


async def _me(request: Request, session: str | None) -> Me | None:
    accounts: AccountService = request.app.state.accounts
    return await accounts.me(session)


def _is_owner(settings: Settings, me: Me | None) -> bool:
    return me is not None and me.battletag == settings.mcp_owner_battletag


def _go(url: str) -> RedirectResponse:
    return RedirectResponse(url, status_code=302, headers={"Cache-Control": "no-store"})


def _gone() -> Response:
    return error(400, "consent_expired", "요청이 만료되었습니다. ChatGPT에서 다시 연결하세요.")


@router.get(PATH)
async def consent_page(
    request: Request,
    req: Annotated[str, Query(min_length=16, max_length=128)],
    session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> Response:
    settings: Settings = request.app.state.settings
    pending = await _provider(request).pending(req)
    if pending is None:
        return _gone()
    me = await _me(request, session)
    if me is None:
        here = f"{PATH}?{urlencode({'req': req})}"
        return _go(f"/v1/auth/battlenet/login?{urlencode({'next': here})}")
    if not _is_owner(settings, me):
        target = await _provider(request).refuse(req)
        return _go(target) if target else _gone()
    back = urlparse(pending.redirect_uri)
    csp = (
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; "
        f"form-action 'self' {back.scheme}://{back.netloc}"
    )
    return HTMLResponse(
        _page(req, pending.client_name, pending.redirect_uri, me.battletag),
        headers={
            "Cache-Control": "no-store",
            "Content-Security-Policy": csp,
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
        },
    )


@router.post(PATH)
async def consent_answer(
    request: Request,
    req: Annotated[str, Form(min_length=16, max_length=128)],
    decision: Annotated[str, Form(pattern="^(allow|deny)$")],
    session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> Response:
    settings: Settings = request.app.state.settings
    origin = request.headers.get("origin")
    if origin is None or origin not in {settings.api_url, *settings.cors_origins}:
        return error(403, "forbidden_origin", "허용되지 않은 출처입니다.")
    me = await _me(request, session)
    provider = _provider(request)
    if decision == "allow" and _is_owner(settings, me) and me is not None:
        target = await provider.approve(req, me.account_id)
    else:
        target = await provider.refuse(req)
    return _go(target) if target else _gone()


_CSS = " ".join(
    [
        "body{font:15px/1.6 system-ui,sans-serif;margin:0;padding:32px 16px;",
        "background:#f3f5f7;color:#17202a}",
        "main{max-width:520px;margin:0 auto;background:#fff;border:1px solid #d6dde4;",
        "border-radius:8px;padding:24px}",
        "h1{font-size:1.25rem;margin:0 0 12px} dt{color:#5b6875;font-size:.85rem}",
        "dd{margin:0 0 10px;word-break:break-all}",
        "form{display:flex;gap:8px;margin-top:16px}",
        "button{font:inherit;padding:8px 16px;border-radius:6px;cursor:pointer}",
        ".allow{background:#2c5d8f;color:#fff;border:1px solid #2c5d8f}",
        ".deny{background:#fff;color:#17202a;border:1px solid #d6dde4}",
    ]
)


def _page(req: str, client: str, redirect_uri: str, battletag: str) -> str:
    return f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HP-GG 연결 허용</title>
<style>{_CSS}</style></head><body><main>
<h1>내 전적 읽기를 허용할까요?</h1>
<p>허용하면 아래 앱이 {escape(battletag)} 계정의 폭풍리그 전적과 영웅풀을 읽을 수 있습니다.
쓰기 권한은 없습니다.</p>
<dl><dt>앱</dt><dd>{escape(client)}</dd>
<dt>코드를 받을 주소</dt><dd>{escape(redirect_uri)}</dd></dl>
<p>직접 연결을 시작한 게 아니라면 거부하세요.</p>
<form method="post" action="{PATH}">
<input type="hidden" name="req" value="{escape(req)}">
<button class="allow" name="decision" value="allow" type="submit">허용</button>
<button class="deny" name="decision" value="deny" type="submit">거부</button>
</form></main></body></html>"""

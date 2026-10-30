"""Battle.net sign-in: authorization code with state + PKCE, then our own session.

Blizzard's access token lives only inside `finish` (one userinfo call) and is never stored or
logged. The database keeps SHA-256 hashes of the sign-in state and of the session cookie, so a
copy of the file opens nobody's session.
"""

from __future__ import annotations

import base64
import hashlib
import re
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
import structlog
from sqlalchemy import delete, select, update

from server.accounts.models import Account, HeroPoolChoice, OAuthState, Session
from server.comments.models import Comment
from server.config import Settings
from server.db import Database

log = structlog.get_logger(__name__)

DEFAULT_NEXT = "/ko/hots/"
REGIONS = ("KR", "NA", "EU")
# a path on the site: "/x…", never "//host", "/\host" or a scheme
_SAFE_NEXT = re.compile(r"^/(?![/\\])[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*$")
# last_seen_at is written at most this often (a /me per page view would be a write per view)
_SEEN_EVERY = 3600.0


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def safe_next(path: str | None) -> str:
    if path and len(path) <= 512 and _SAFE_NEXT.match(path):
        return path
    return DEFAULT_NEXT


@dataclass(frozen=True)
class LoginStart:
    url: str
    state: str


@dataclass(frozen=True)
class LoginResult:
    next_path: str
    # None = no session (refused, cancelled or failed); `outcome` says which for the site
    session_token: str | None
    outcome: str  # "ok" | "cancelled" | "failed"


@dataclass(frozen=True)
class Me:
    account_id: int
    battletag: str
    region: str | None


class AccountService:
    def __init__(
        self,
        db: Database,
        settings: Settings,
        http: httpx.AsyncClient,
        clock: Callable[[], float],
    ) -> None:
        self._db = db
        self._s = settings
        self._http = http
        self._clock = clock

    @property
    def enabled(self) -> bool:
        return bool(self._s.bnet_client_id and self._s.bnet_client_secret.get_secret_value())

    async def start(self, next_path: str | None) -> LoginStart:
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(48)
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        now = self._clock()
        async with self._db.session() as s, s.begin():
            # sign-ins nobody finished: gone once they could no longer be used
            await s.execute(
                delete(OAuthState).where(
                    OAuthState.created_at < now - self._s.oauth_state_ttl_seconds
                )
            )
            s.add(
                OAuthState(
                    state_hash=_hash(state),
                    verifier=verifier,
                    next_path=safe_next(next_path),
                    created_at=now,
                )
            )
        query = urlencode(
            {
                "client_id": self._s.bnet_client_id,
                "redirect_uri": self._s.bnet_redirect_uri,
                "response_type": "code",
                "scope": "openid",
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        return LoginStart(url=f"{self._s.bnet_oauth_base}/authorize?{query}", state=state)

    async def _take_state(self, state: str) -> OAuthState | None:
        """The sign-in for `state`, removed (single use); None if unknown or too old."""
        async with self._db.session() as s, s.begin():
            row = await s.get(OAuthState, _hash(state))
            if row is None:
                return None
            await s.delete(row)
        if row.created_at < self._clock() - self._s.oauth_state_ttl_seconds:
            return None
        return row

    async def finish(
        self,
        *,
        state: str | None,
        browser_state: str | None,
        code: str | None,
        error: str | None,
    ) -> LoginResult:
        if not state or not browser_state or not secrets.compare_digest(state, browser_state):
            log.info("accounts.login_refused", reason="state_mismatch")
            return LoginResult(DEFAULT_NEXT, None, "failed")
        pending = await self._take_state(state)
        if pending is None:
            log.info("accounts.login_refused", reason="state_unknown_or_expired")
            return LoginResult(DEFAULT_NEXT, None, "failed")
        if error or not code:
            log.info("accounts.login_cancelled", reason=error or "no_code")
            return LoginResult(pending.next_path, None, "cancelled")
        try:
            user = await self._userinfo(code, pending.verifier)
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            log.warning("accounts.login_failed", reason=type(exc).__name__)
            return LoginResult(pending.next_path, None, "failed")
        account_id = await self._upsert(user["bnet_id"], user["battletag"])
        token = await self._new_session(account_id)
        log.info("accounts.login", account_id=account_id)
        return LoginResult(pending.next_path, token, "ok")

    async def _userinfo(self, code: str, verifier: str) -> dict[str, str]:
        """Code → token → userinfo. The token stays in this function."""
        r = await self._http.post(
            f"{self._s.bnet_oauth_base}/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self._s.bnet_redirect_uri,
                "code_verifier": verifier,
            },
            auth=(self._s.bnet_client_id, self._s.bnet_client_secret.get_secret_value()),
        )
        r.raise_for_status()
        access = r.json()["access_token"]
        u = await self._http.get(
            f"{self._s.bnet_oauth_base}/userinfo",
            headers={"Authorization": f"Bearer {access}"},
        )
        u.raise_for_status()
        body = u.json()
        bnet_id = str(body.get("id") or body["sub"])
        battletag = str(body["battletag"])
        if not bnet_id or "#" not in battletag:
            raise ValueError("userinfo without an id or a BattleTag")
        return {"bnet_id": bnet_id, "battletag": battletag}

    async def _upsert(self, bnet_id: str, battletag: str) -> int:
        now = self._clock()
        async with self._db.session() as s, s.begin():
            acc = (
                await s.execute(select(Account).where(Account.bnet_id == bnet_id))
            ).scalar_one_or_none()
            if acc is None:
                acc = Account(
                    bnet_id=bnet_id, battletag=battletag, created_at=now, last_seen_at=now
                )
                s.add(acc)
                await s.flush()
            else:
                acc.battletag = battletag  # a BattleTag can be renamed
                acc.last_seen_at = now
            return acc.id

    async def _new_session(self, account_id: int) -> str:
        token = secrets.token_urlsafe(32)
        now = self._clock()
        async with self._db.session() as s, s.begin():
            await s.execute(delete(Session).where(Session.expires_at < now))
            s.add(
                Session(
                    token_hash=_hash(token),
                    account_id=account_id,
                    created_at=now,
                    expires_at=now + self._s.session_ttl_seconds,
                )
            )
        return token

    async def me(self, token: str | None) -> Me | None:
        if not token:
            return None
        now = self._clock()
        async with self._db.session() as s, s.begin():
            row = (
                await s.execute(
                    select(Session, Account)
                    .join(Account, Account.id == Session.account_id)
                    .where(Session.token_hash == _hash(token), Session.expires_at > now)
                )
            ).one_or_none()
            if row is None:
                return None
            _, acc = row
            if acc.last_seen_at < now - _SEEN_EVERY:
                acc.last_seen_at = now
            return Me(account_id=acc.id, battletag=acc.battletag, region=acc.region)

    async def set_region(self, account_id: int, region: str) -> None:
        async with self._db.session() as s, s.begin():
            await s.execute(update(Account).where(Account.id == account_id).values(region=region))

    async def logout(self, token: str) -> None:
        async with self._db.session() as s, s.begin():
            await s.execute(delete(Session).where(Session.token_hash == _hash(token)))

    async def delete_account(self, account_id: int) -> None:
        """The account, its sessions and hero pool, and its link from comments; comments stay."""
        async with self._db.session() as s, s.begin():
            await s.execute(
                update(Comment).where(Comment.account_id == str(account_id)).values(account_id=None)
            )
            await s.execute(delete(Session).where(Session.account_id == account_id))
            await s.execute(delete(HeroPoolChoice).where(HeroPoolChoice.account_id == account_id))
            await s.execute(delete(Account).where(Account.id == account_id))
        log.info("accounts.deleted", account_id=account_id)

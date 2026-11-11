"""HP-GG as the OAuth 2.1 authorization server for the owner's MCP.

The MCP SDK serves the endpoints (/register, /authorize, /token, metadata) and checks PKCE; this
provider keeps clients, consents, codes and tokens. /authorize never issues a code by itself: it
sends the browser to the consent page (`consent.py`), where only the owner's Battle.net account can
press allow. Codes and tokens are random and stored as SHA-256 hashes, like the session cookie.
"""

from __future__ import annotations

import hashlib
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlencode

import structlog
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    IdentityAssertionParams,
    RefreshToken,
    RegistrationError,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from sqlalchemy import delete, select

from server.config import Settings
from server.db import Database
from server.mcp.models import McpAuthRequest, McpClient, McpCode, McpToken

log = structlog.get_logger(__name__)

SCOPE = "hpgg"


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def redirect_allowed(uri: str, allowed: list[str]) -> bool:
    """Exact match, or under an allowed prefix that ends in '/' (ChatGPT's per-connector path)."""
    for a in allowed:
        if a.endswith("/"):
            rest = uri.removeprefix(a)
            if rest != uri and rest and "/" not in rest and "?" not in rest and "#" not in rest:
                return True
        elif uri == a:
            return True
    return False


@dataclass(frozen=True)
class PendingConsent:
    client_name: str
    redirect_uri: str
    state: str | None


class OwnerOAuthProvider:
    def __init__(self, db: Database, settings: Settings, clock: Callable[[], float]) -> None:
        self._db = db
        self._s = settings
        self._clock = clock

    def _wall(self, ts: float) -> float:
        """Our expiry (on the injected clock) on the wall clock the SDK compares with: expiry is
        checked here first, the SDK's own check then agrees with it."""
        return time.time() + (ts - self._clock())

    @property
    def resource(self) -> str:
        return self._s.api_url + "/mcp"

    # -- clients --------------------------------------------------------------------------

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        async with self._db.session() as s:
            row = await s.get(McpClient, client_id)
        if row is None:
            return None
        return OAuthClientInformationFull.model_validate_json(row.info)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        uris = [str(u) for u in client_info.redirect_uris or []]
        if not uris or not all(redirect_allowed(u, self._s.mcp_redirect_uris) for u in uris):
            raise RegistrationError("invalid_redirect_uri", "only ChatGPT's redirect URIs")
        assert client_info.client_id is not None
        async with self._db.session() as s, s.begin():
            s.add(
                McpClient(
                    client_id=client_info.client_id,
                    info=client_info.model_dump_json(),
                    created_at=self._clock(),
                )
            )
        log.info("mcp.client_registered", client_name=client_info.client_name)

    # -- authorize → consent → code ---------------------------------------------------------

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        req = secrets.token_urlsafe(32)
        now = self._clock()
        async with self._db.session() as s, s.begin():
            await s.execute(
                delete(McpAuthRequest).where(
                    McpAuthRequest.created_at < now - self._s.oauth_state_ttl_seconds
                )
            )
            s.add(
                McpAuthRequest(
                    req_hash=_hash(req),
                    client_id=client.client_id or "",
                    params=params.model_dump_json(),
                    created_at=now,
                )
            )
        return f"{self._s.api_url}/mcp/consent?{urlencode({'req': req})}"

    async def _request(
        self, req: str, *, take: bool
    ) -> tuple[OAuthClientInformationFull, AuthorizationParams] | None:
        async with self._db.session() as s, s.begin():
            row = await s.get(McpAuthRequest, _hash(req))
            if row is None:
                return None
            if take:
                await s.delete(row)
        if row.created_at < self._clock() - self._s.oauth_state_ttl_seconds:
            return None
        client = await self.get_client(row.client_id)
        if client is None:
            return None
        return client, AuthorizationParams.model_validate_json(row.params)

    async def pending(self, req: str) -> PendingConsent | None:
        found = await self._request(req, take=False)
        if found is None:
            return None
        client, params = found
        return PendingConsent(
            client_name=client.client_name or client.client_id or "?",
            redirect_uri=str(params.redirect_uri),
            state=params.state,
        )

    async def refuse(self, req: str) -> str | None:
        """The redirect back to the client with access_denied; None if the request is gone."""
        found = await self._request(req, take=True)
        if found is None:
            return None
        _, params = found
        return construct_redirect_uri(
            str(params.redirect_uri), error="access_denied", state=params.state
        )

    async def approve(self, req: str, account_id: int) -> str | None:
        """A code for the owner; the redirect back to the client. None if the request is gone."""
        found = await self._request(req, take=True)
        if found is None:
            return None
        client, params = found
        code = secrets.token_urlsafe(32)
        now = self._clock()
        async with self._db.session() as s, s.begin():
            await s.execute(delete(McpCode).where(McpCode.expires_at < now))
            s.add(
                McpCode(
                    code_hash=_hash(code),
                    client_id=client.client_id or "",
                    account_id=account_id,
                    params=params.model_dump_json(),
                    expires_at=now + self._s.mcp_code_ttl_seconds,
                )
            )
        log.info("mcp.consent_given", client_name=client.client_name)
        return construct_redirect_uri(str(params.redirect_uri), code=code, state=params.state)

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        async with self._db.session() as s:
            row = await s.get(McpCode, _hash(authorization_code))
        if row is None or row.client_id != client.client_id or row.expires_at <= self._clock():
            return None
        params = AuthorizationParams.model_validate_json(row.params)
        return AuthorizationCode(
            code=authorization_code,
            scopes=params.scopes or [SCOPE],
            expires_at=self._wall(row.expires_at),
            client_id=row.client_id,
            code_challenge=params.code_challenge,
            redirect_uri=params.redirect_uri,
            redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
            resource=params.resource or self.resource,
            subject=str(row.account_id),
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        async with self._db.session() as s, s.begin():
            await s.execute(
                delete(McpCode).where(McpCode.code_hash == _hash(authorization_code.code))
            )
        return await self._issue(
            client.client_id or "",
            int(authorization_code.subject or 0),
            authorization_code.scopes,
            authorization_code.resource,
        )

    # -- tokens -----------------------------------------------------------------------------

    async def _issue(
        self, client_id: str, account_id: int, scopes: list[str], resource: str | None
    ) -> OAuthToken:
        access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        now = self._clock()
        common = {
            "client_id": client_id,
            "account_id": account_id,
            "scopes": " ".join(scopes),
            "resource": resource or self.resource,
        }
        async with self._db.session() as s, s.begin():
            await s.execute(delete(McpToken).where(McpToken.expires_at < now))
            s.add(
                McpToken(
                    token_hash=_hash(access),
                    kind="access",
                    expires_at=now + self._s.mcp_access_ttl_seconds,
                    **common,
                )
            )
            s.add(
                McpToken(
                    token_hash=_hash(refresh),
                    kind="refresh",
                    expires_at=now + self._s.mcp_refresh_ttl_seconds,
                    **common,
                )
            )
        return OAuthToken(
            access_token=access,
            token_type="Bearer",
            expires_in=self._s.mcp_access_ttl_seconds,
            refresh_token=refresh,
            scope=" ".join(scopes),
        )

    async def _token(self, token: str, kind: str) -> McpToken | None:
        async with self._db.session() as s:
            row = (
                await s.execute(
                    select(McpToken).where(
                        McpToken.token_hash == _hash(token), McpToken.kind == kind
                    )
                )
            ).scalar_one_or_none()
        if row is None or row.expires_at <= self._clock():
            return None
        return row

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        row = await self._token(refresh_token, "refresh")
        if row is None or row.client_id != client.client_id:
            return None
        return RefreshToken(
            token=refresh_token,
            client_id=row.client_id,
            scopes=row.scopes.split(),
            expires_at=int(self._wall(row.expires_at)),
            resource=row.resource,
            subject=str(row.account_id),
        )

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]
    ) -> OAuthToken:
        async with self._db.session() as s, s.begin():
            await s.execute(
                delete(McpToken).where(McpToken.token_hash == _hash(refresh_token.token))
            )
        return await self._issue(
            client.client_id or "",
            int(refresh_token.subject or 0),
            scopes or refresh_token.scopes,
            refresh_token.resource,
        )

    async def load_access_token(self, token: str) -> AccessToken | None:
        row = await self._token(token, "access")
        if row is None:
            return None
        return AccessToken(
            token=token,
            client_id=row.client_id,
            scopes=row.scopes.split(),
            expires_at=int(self._wall(row.expires_at)),
            resource=row.resource,
            subject=str(row.account_id),
        )

    async def exchange_identity_assertion(
        self, client: OAuthClientInformationFull, params: IdentityAssertionParams
    ) -> OAuthToken:
        """Enterprise ID-JAG grants (SEP-990) are not offered: only the owner's consent issues."""
        raise TokenError("unsupported_grant_type", "only authorization_code and refresh_token")

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        async with self._db.session() as s, s.begin():
            await s.execute(delete(McpToken).where(McpToken.token_hash == _hash(token.token)))

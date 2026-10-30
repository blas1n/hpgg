"""Shared by the account tests: a fake Battle.net and the sign-in steps (fixtures in conftest)."""

from __future__ import annotations

import sqlite3
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi.testclient import TestClient

from server.config import Settings

CLIENT_ID = "bnet-client-id-123"
CLIENT_SECRET = "fake-client-secret"
BNET_TOKEN = "fake-access-token"
ORIGIN = {"Origin": "https://hpgg.win"}


class FakeBnet:
    """Battle.net's token and userinfo endpoints; records every request."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.user = {"sub": "123456", "id": 123456, "battletag": "blAs1N#3479"}
        self.token_status = 200

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == "/token":
            if self.token_status != 200:
                return httpx.Response(self.token_status, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": BNET_TOKEN, "token_type": "bearer"})
        if request.url.path == "/userinfo":
            assert request.headers["authorization"] == f"Bearer {BNET_TOKEN}"
            return httpx.Response(200, json=self.user)
        return httpx.Response(404)


def start(c: TestClient, next_path: str = "/ko/hots/draft/") -> dict[str, str]:
    r = c.get("/v1/auth/battlenet/login", params={"next": next_path})
    assert r.status_code == 302
    q = parse_qs(urlparse(r.headers["location"]).query)
    return {k: v[0] for k, v in q.items()}


def sign_in(c: TestClient, next_path: str = "/ko/hots/draft/") -> httpx.Response:
    q = start(c, next_path)
    return c.get("/v1/auth/battlenet/callback", params={"code": "the-code", "state": q["state"]})


def db_text(settings: Settings) -> str:
    con = sqlite3.connect(settings.db_path)
    try:
        return "\n".join(con.iterdump())
    finally:
        con.close()

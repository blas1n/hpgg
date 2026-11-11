"""Shared by the owner-MCP tests: the ChatGPT side of the OAuth dance and JSON-RPC calls."""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from tests.server.accounts_support import ORIGIN, sign_in

OWNER = "blAs1N#3479"
REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect"
RESOURCE = "https://api.hpgg.win/mcp"
VERIFIER = "v" * 64
CHALLENGE = (
    base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()
)
MCP_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": "2025-06-18",
}


def register(c: TestClient, redirect: str = REDIRECT) -> str:
    r = c.post(
        "/register",
        json={
            "redirect_uris": [redirect],
            "client_name": "ChatGPT",
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
        },
    )
    assert r.status_code == 201, r.text
    client_id: str = r.json()["client_id"]
    return client_id


def authorize(c: TestClient, client_id: str, state: str = "st-1") -> str:
    """GET /authorize → the consent page path HP-GG sends the browser to."""
    r = c.get(
        "/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": REDIRECT,
            "code_challenge": CHALLENGE,
            "code_challenge_method": "S256",
            "state": state,
            "resource": RESOURCE,
        },
    )
    assert r.status_code == 302, r.text
    loc = r.headers["location"]
    assert loc.startswith("https://api.hpgg.win/mcp/consent?"), loc
    return loc.removeprefix("https://api.hpgg.win")


def approve(c: TestClient, consent_path: str) -> dict[str, str]:
    """Owner signed in: the consent page, then its allow button. Returns the redirect query."""
    page = c.get(consent_path)
    assert page.status_code == 200, page.text
    req = parse_qs(urlparse(consent_path).query)["req"][0]
    r = c.post("/mcp/consent", data={"req": req, "decision": "allow"}, headers=ORIGIN)
    assert r.status_code == 302, r.text
    loc = r.headers["location"]
    assert loc.startswith(REDIRECT + "?"), loc
    return {k: v[0] for k, v in parse_qs(urlparse(loc).query).items()}


def exchange(c: TestClient, client_id: str, code: str, verifier: str = VERIFIER) -> Any:
    return c.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT,
            "client_id": client_id,
            "code_verifier": verifier,
            "resource": RESOURCE,
        },
    )


def connect(c: TestClient) -> dict[str, Any]:
    """The whole flow for the owner: register, sign in, approve, exchange. Returns the tokens."""
    client_id = register(c)
    consent = authorize(c, client_id)
    sign_in(c)
    q = approve(c, consent)
    r = exchange(c, client_id, q["code"])
    assert r.status_code == 200, r.text
    tokens: dict[str, Any] = r.json()
    tokens["client_id"] = client_id
    return tokens


def rpc(c: TestClient, token: str, method: str, params: dict[str, Any] | None = None) -> Any:
    r = c.post(
        "/mcp",
        headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"},
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
    )
    return r


def call_tool(c: TestClient, token: str, name: str, **arguments: Any) -> dict[str, Any]:
    r = rpc(c, token, "tools/call", {"name": name, "arguments": arguments})
    assert r.status_code == 200, r.text
    result = r.json()["result"]
    assert not result.get("isError"), result
    payload: dict[str, Any] = result.get("structuredContent") or json.loads(
        result["content"][0]["text"]
    )
    return payload

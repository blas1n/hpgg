"""The owner-only MCP's OAuth (docs/DESIGN-2026-11-11-owner-mcp.md, owner 2026-11-11).

ChatGPT connects to a remote MCP only through OAuth 2.1 (authorization code + PKCE S256) with
dynamic client registration. HP-GG is the authorization server; a token is issued only after the
owner — the Battle.net account named by `mcp_owner_battletag` — presses allow on the consent page.
HP's API terms §3 allow HP data on our own API for personal use only, so nobody else gets one.
"""

from __future__ import annotations

import base64
import hashlib
import sqlite3
from collections.abc import Callable
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from server.config import Settings
from tests.server.accounts_support import ORIGIN, sign_in, start
from tests.server.conftest import Clock
from tests.server.mcp_support import (
    MCP_HEADERS,
    OWNER,
    REDIRECT,
    RESOURCE,
    approve,
    authorize,
    connect,
    exchange,
    register,
    rpc,
)


@pytest.fixture
def mcp_client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client(mcp_owner_battletag=OWNER)


def test_off_without_an_owner(make_client: Callable[..., TestClient]) -> None:
    c = make_client()
    assert c.get("/.well-known/oauth-authorization-server").status_code == 404
    assert c.post("/mcp", json={}).status_code == 404
    assert c.get("/healthz").status_code == 200


def test_discovery_documents(mcp_client: TestClient) -> None:
    meta = mcp_client.get("/.well-known/oauth-authorization-server").json()
    assert meta["issuer"] == "https://api.hpgg.win"
    assert meta["authorization_endpoint"] == "https://api.hpgg.win/authorize"
    assert meta["registration_endpoint"] == "https://api.hpgg.win/register"
    assert "S256" in meta["code_challenge_methods_supported"]
    prm = mcp_client.get("/.well-known/oauth-protected-resource/mcp").json()
    assert prm["resource"] == RESOURCE
    assert prm["authorization_servers"] == ["https://api.hpgg.win"]


def test_mcp_without_a_token_points_at_the_metadata(mcp_client: TestClient) -> None:
    r = mcp_client.post("/mcp", headers=MCP_HEADERS, json={})
    assert r.status_code == 401
    assert "oauth-protected-resource" in r.headers["www-authenticate"]


def test_registration_only_for_chatgpt_redirects(mcp_client: TestClient) -> None:
    r = mcp_client.post(
        "/register",
        json={
            "redirect_uris": ["https://evil.example/cb"],
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
        },
    )
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_redirect_uri"
    # ChatGPT's per-connector callback is fine too
    register(mcp_client, "https://chatgpt.com/connector/oauth/abc123")


def test_owner_connects_and_lists_tools(mcp_client: TestClient) -> None:
    tokens = connect(mcp_client)
    assert tokens["token_type"].lower() == "bearer"
    assert tokens["refresh_token"]
    r = rpc(
        mcp_client,
        tokens["access_token"],
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "chatgpt", "version": "1"},
        },
    )
    assert r.status_code == 200, r.text
    r = rpc(mcp_client, tokens["access_token"], "tools/list")
    names = {t["name"] for t in r.json()["result"]["tools"]}
    assert names == {
        "get_status",
        "list_matches",
        "get_match",
        "summarize",
        "get_hero_pool",
        "get_baseline",
        "get_tier_list",
    }
    for t in r.json()["result"]["tools"]:
        assert t["annotations"]["readOnlyHint"] is True


def test_state_comes_back(mcp_client: TestClient) -> None:
    client_id = register(mcp_client)
    consent = authorize(mcp_client, client_id, state="xyz-42")
    sign_in(mcp_client)
    assert approve(mcp_client, consent)["state"] == "xyz-42"


def test_signed_out_owner_goes_through_battlenet_and_back(mcp_client: TestClient) -> None:
    client_id = register(mcp_client)
    consent = authorize(mcp_client, client_id)
    r = mcp_client.get(consent)
    assert r.status_code == 302
    login = urlparse(r.headers["location"])
    assert login.path == "/v1/auth/battlenet/login"
    next_path = parse_qs(login.query)["next"][0]
    assert next_path == consent
    q = start(mcp_client, next_path)
    back = mcp_client.get("/v1/auth/battlenet/callback", params={"code": "c", "state": q["state"]})
    # back to the consent page on the API, not to the site
    assert back.headers["location"] == "https://api.hpgg.win" + consent
    assert mcp_client.get(consent).status_code == 200


def test_consent_page_names_the_client_and_where_the_code_goes(mcp_client: TestClient) -> None:
    client_id = register(mcp_client)
    consent = authorize(mcp_client, client_id)
    sign_in(mcp_client)
    page = mcp_client.get(consent)
    assert "ChatGPT" in page.text
    assert REDIRECT in page.text
    assert OWNER in page.text
    assert page.headers["cache-control"] == "no-store"
    assert "frame-ancestors 'none'" in page.headers["content-security-policy"]


def test_someone_else_is_refused(mcp_client: TestClient, bnet: object) -> None:
    bnet.user = {"sub": "999", "id": 999, "battletag": "Someone#1111"}  # type: ignore[attr-defined]
    client_id = register(mcp_client)
    consent = authorize(mcp_client, client_id)
    sign_in(mcp_client)
    r = mcp_client.get(consent)
    assert r.status_code == 302
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert r.headers["location"].startswith(REDIRECT)
    assert q["error"] == ["access_denied"]
    req = parse_qs(urlparse(consent).query)["req"][0]
    r = mcp_client.post("/mcp/consent", data={"req": req, "decision": "allow"}, headers=ORIGIN)
    assert "code" not in parse_qs(urlparse(r.headers.get("location", "")).query)


def test_deny_sends_access_denied(mcp_client: TestClient) -> None:
    client_id = register(mcp_client)
    consent = authorize(mcp_client, client_id)
    sign_in(mcp_client)
    req = parse_qs(urlparse(consent).query)["req"][0]
    r = mcp_client.post("/mcp/consent", data={"req": req, "decision": "deny"}, headers=ORIGIN)
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert q["error"] == ["access_denied"]
    assert "code" not in q


def test_allow_from_another_site_is_refused(mcp_client: TestClient) -> None:
    client_id = register(mcp_client)
    consent = authorize(mcp_client, client_id)
    sign_in(mcp_client)
    req = parse_qs(urlparse(consent).query)["req"][0]
    r = mcp_client.post(
        "/mcp/consent",
        data={"req": req, "decision": "allow"},
        headers={"Origin": "https://evil.example"},
    )
    assert r.status_code == 403


def test_a_request_is_single_use(mcp_client: TestClient) -> None:
    client_id = register(mcp_client)
    consent = authorize(mcp_client, client_id)
    sign_in(mcp_client)
    approve(mcp_client, consent)
    req = parse_qs(urlparse(consent).query)["req"][0]
    r = mcp_client.post("/mcp/consent", data={"req": req, "decision": "allow"}, headers=ORIGIN)
    assert r.status_code == 400


def test_pkce_is_checked(mcp_client: TestClient) -> None:
    client_id = register(mcp_client)
    consent = authorize(mcp_client, client_id)
    sign_in(mcp_client)
    q = approve(mcp_client, consent)
    r = exchange(mcp_client, client_id, q["code"], verifier="w" * 64)
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_grant"


def test_a_code_works_once(mcp_client: TestClient) -> None:
    client_id = register(mcp_client)
    consent = authorize(mcp_client, client_id)
    sign_in(mcp_client)
    q = approve(mcp_client, consent)
    assert exchange(mcp_client, client_id, q["code"]).status_code == 200
    assert exchange(mcp_client, client_id, q["code"]).status_code == 400


def test_access_token_expires(mcp_client: TestClient, clock: Clock, settings: Settings) -> None:
    tokens = connect(mcp_client)
    assert tokens["expires_in"] == 3600
    clock.now += 3601
    assert rpc(mcp_client, tokens["access_token"], "tools/list").status_code == 401


def test_refresh_rotates(mcp_client: TestClient, clock: Clock) -> None:
    tokens = connect(mcp_client)
    clock.now += 3601
    r = mcp_client.post(
        "/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": tokens["refresh_token"],
            "client_id": tokens["client_id"],
        },
    )
    assert r.status_code == 200, r.text
    fresh = r.json()
    assert fresh["refresh_token"] != tokens["refresh_token"]
    assert rpc(mcp_client, fresh["access_token"], "tools/list").status_code == 200
    again = mcp_client.post(
        "/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": tokens["refresh_token"],
            "client_id": tokens["client_id"],
        },
    )
    assert again.status_code == 400


def test_tokens_are_stored_hashed(mcp_client: TestClient, settings: Settings) -> None:
    tokens = connect(mcp_client)
    con = sqlite3.connect(settings.db_path)
    try:
        dump = "\n".join(con.iterdump())
    finally:
        con.close()
    for t in (tokens["access_token"], tokens["refresh_token"]):
        assert t not in dump
        assert hashlib.sha256(t.encode()).hexdigest() in dump


def test_deleting_the_account_revokes_its_tokens(mcp_client: TestClient) -> None:
    tokens = connect(mcp_client)
    assert mcp_client.delete("/v1/me", headers=ORIGIN).status_code == 204
    assert rpc(mcp_client, tokens["access_token"], "tools/list").status_code == 401


def test_challenge_must_be_s256(mcp_client: TestClient) -> None:
    client_id = register(mcp_client)
    r = mcp_client.get(
        "/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": REDIRECT,
            "code_challenge": base64.urlsafe_b64encode(b"x" * 32).decode(),
            "code_challenge_method": "plain",
            "state": "s",
        },
    )
    assert r.status_code in (302, 400)
    assert "consent" not in r.headers.get("location", "")

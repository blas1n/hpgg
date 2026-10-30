"""Battle.net sign-in (#28, owner 2026-10-30): members get the hero-pool 밴픽; guests keep today's
site. Authorization-code flow with state + PKCE; only the account id and BattleTag are kept, the
Blizzard token is dropped right after the userinfo call; our own session is an HttpOnly cookie on
api.hpgg.win whose hash is all the database holds."""

from __future__ import annotations

import base64
import hashlib
import sqlite3
from collections.abc import Callable, Iterator
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from server.app import create_app
from server.config import Settings
from tests.server.conftest import Clock, FakeHP

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


@pytest.fixture
def bnet() -> FakeBnet:
    return FakeBnet()


@pytest.fixture
def make_client(
    settings: Settings, fake_hp: FakeHP, clock: Clock, bnet: FakeBnet
) -> Iterator[Callable[..., TestClient]]:
    opened: list[TestClient] = []

    def make(**overrides: object) -> TestClient:
        s = settings.model_copy(
            update={
                "bnet_client_id": CLIENT_ID,
                "bnet_client_secret": SecretStr(CLIENT_SECRET),  # model_copy does not validate
                **overrides,
            }
        )
        app = create_app(
            s,
            hp_transport=fake_hp.transport,
            bnet_transport=httpx.MockTransport(bnet),
            clock=clock,
            privacy_poll=False,
        )
        c = TestClient(app, base_url="https://api.hpgg.win", follow_redirects=False)
        c.__enter__()
        opened.append(c)
        return c

    yield make
    for c in opened:
        c.__exit__(None, None, None)


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client()


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


# --- login ---------------------------------------------------------------------------------


def test_login_sends_the_browser_to_battle_net_with_state_and_pkce(client: TestClient) -> None:
    r = client.get("/v1/auth/battlenet/login", params={"next": "/ko/hots/draft/"})
    assert r.status_code == 302
    loc = urlparse(r.headers["location"])
    assert (loc.scheme, loc.netloc, loc.path) == ("https", "oauth.battle.net", "/authorize")
    q = {k: v[0] for k, v in parse_qs(loc.query).items()}
    assert q["client_id"] == CLIENT_ID
    assert q["redirect_uri"] == "https://api.hpgg.win/v1/auth/battlenet/callback"
    assert q["response_type"] == "code"
    assert q["scope"] == "openid"
    assert len(q["state"]) >= 32
    assert q["code_challenge_method"] == "S256" and len(q["code_challenge"]) >= 43
    assert CLIENT_SECRET not in r.headers["location"]
    # the state is tied to this browser too (login CSRF): a cookie only the callback sees
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Secure" in cookie and "Path=/v1/auth" in cookie


def test_a_sign_in_creates_the_account_and_a_session(
    client: TestClient, bnet: FakeBnet, settings: Settings
) -> None:
    q = start(client)
    r = client.get("/v1/auth/battlenet/callback", params={"code": "the-code", "state": q["state"]})
    assert r.status_code == 302
    assert r.headers["location"] == "https://hpgg.win/ko/hots/draft/"
    session = [h for h in r.headers.get_list("set-cookie") if h.startswith("hpgg_session=")][0]
    assert "HttpOnly" in session and "Secure" in session and "SameSite=lax" in session

    # the code exchange: client credentials in Basic auth, the PKCE verifier that matches
    token_req = next(x for x in bnet.requests if x.url.path == "/token")
    assert (
        token_req.headers["authorization"]
        == "Basic " + base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
    )
    form = {k: v[0] for k, v in parse_qs(token_req.content.decode()).items()}
    assert form["grant_type"] == "authorization_code" and form["code"] == "the-code"
    assert form["redirect_uri"] == "https://api.hpgg.win/v1/auth/battlenet/callback"
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(form["code_verifier"].encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    assert challenge == q["code_challenge"]

    me = client.get("/v1/me")
    assert me.status_code == 200
    assert me.json() == {"battletag": "blAs1N#3479", "region": None}
    assert me.headers["cache-control"] == "no-store"

    # kept: the account id and BattleTag. Not kept: Blizzard's token, our raw session token.
    dump = db_text(settings)
    assert "blAs1N#3479" in dump and "123456" in dump
    assert BNET_TOKEN not in dump
    assert client.cookies["hpgg_session"] not in dump


def test_a_next_path_off_the_site_is_ignored(client: TestClient) -> None:
    for bad in ["https://evil.example/", "//evil.example/x", "/\\evil.example", "ko/hots/"]:
        q = start(client, bad)
        r = client.get("/v1/auth/battlenet/callback", params={"code": "c", "state": q["state"]})
        assert r.headers["location"] == "https://hpgg.win/ko/hots/", bad


def test_the_same_battle_net_account_signs_in_to_the_same_account(
    client: TestClient, bnet: FakeBnet, settings: Settings
) -> None:
    sign_in(client)
    bnet.user = {"sub": "123456", "id": 123456, "battletag": "Renamed#1111"}
    sign_in(client)
    assert client.get("/v1/me").json()["battletag"] == "Renamed#1111"
    con = sqlite3.connect(settings.db_path)
    assert con.execute("select count(*) from accounts").fetchone() == (1,)
    con.close()


# --- what a callback must refuse -----------------------------------------------------------


def test_a_callback_without_this_browsers_state_is_refused(
    make_client: Callable[..., TestClient], bnet: FakeBnet
) -> None:
    victim, attacker = make_client(), make_client()
    q = start(attacker)  # the attacker's state, replayed in the victim's browser
    r = victim.get("/v1/auth/battlenet/callback", params={"code": "c", "state": q["state"]})
    assert r.headers["location"] == "https://hpgg.win/ko/hots/?login=failed"
    assert not [x for x in bnet.requests if x.url.path == "/token"]
    assert victim.get("/v1/me").status_code == 401


def test_a_state_works_once_and_not_after_ten_minutes(client: TestClient, clock: Clock) -> None:
    q = start(client)
    ok = client.get("/v1/auth/battlenet/callback", params={"code": "c", "state": q["state"]})
    assert ok.headers["location"] == "https://hpgg.win/ko/hots/draft/"
    again = client.get("/v1/auth/battlenet/callback", params={"code": "c", "state": q["state"]})
    assert again.headers["location"].endswith("?login=failed")

    q = start(client)
    clock.now += 601
    late = client.get("/v1/auth/battlenet/callback", params={"code": "c", "state": q["state"]})
    assert late.headers["location"].endswith("?login=failed")


def test_a_cancelled_sign_in_goes_back_without_asking_battle_net(
    client: TestClient, bnet: FakeBnet
) -> None:
    q = start(client)
    r = client.get(
        "/v1/auth/battlenet/callback", params={"error": "access_denied", "state": q["state"]}
    )
    assert r.headers["location"] == "https://hpgg.win/ko/hots/draft/?login=cancelled"
    assert not [x for x in bnet.requests if x.url.path == "/token"]


def test_a_refused_code_signs_nobody_in(client: TestClient, bnet: FakeBnet) -> None:
    bnet.token_status = 400
    r = sign_in(client)
    assert r.headers["location"] == "https://hpgg.win/ko/hots/draft/?login=failed"
    assert client.get("/v1/me").status_code == 401


def test_sign_in_is_off_without_a_client_id(make_client: Callable[..., TestClient]) -> None:
    c = make_client(bnet_client_id="")
    r = c.get("/v1/auth/battlenet/login")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "accounts_disabled"


# --- the session ---------------------------------------------------------------------------


def test_me_without_or_with_an_expired_session_is_401(client: TestClient, clock: Clock) -> None:
    assert client.get("/v1/me").status_code == 401
    sign_in(client)
    assert client.get("/v1/me").status_code == 200
    clock.now += 30 * 86_400 + 1
    assert client.get("/v1/me").status_code == 401


def test_the_region_is_chosen_once_signed_in(client: TestClient) -> None:
    assert client.post("/v1/me/region", json={"region": "KR"}, headers=ORIGIN).status_code == 401
    sign_in(client)
    assert client.post("/v1/me/region", json={"region": "KR"}, headers=ORIGIN).status_code == 204
    assert client.get("/v1/me").json()["region"] == "KR"
    bad = client.post("/v1/me/region", json={"region": "CN"}, headers=ORIGIN)
    assert bad.status_code == 422


def test_changes_from_another_site_are_refused(client: TestClient) -> None:
    sign_in(client)
    evil = {"Origin": "https://evil.example"}
    assert client.post("/v1/me/region", json={"region": "NA"}, headers=evil).status_code == 403
    assert client.post("/v1/auth/logout", headers=evil).status_code == 403
    assert client.delete("/v1/me", headers=evil).status_code == 403
    assert client.get("/v1/me").json()["region"] is None


def test_logout_ends_the_session(client: TestClient) -> None:
    sign_in(client)
    r = client.post("/v1/auth/logout", headers=ORIGIN)
    assert r.status_code == 204
    assert 'hpgg_session=""' in r.headers["set-cookie"] or "Max-Age=0" in r.headers["set-cookie"]
    assert client.get("/v1/me").status_code == 401


def test_deleting_the_account_removes_it_and_unlinks_comments(
    client: TestClient, settings: Settings
) -> None:
    sign_in(client)
    con = sqlite3.connect(settings.db_path)
    account_id = con.execute("select id from accounts").fetchone()[0]
    con.execute(
        "insert into comments (thread, nickname, tag, ip_hash, password_hash, body, account_id,"
        " created_at) values ('hero:valla', 'n', 'abcd', 'h', 'p', 'b', ?, 0)",
        (str(account_id),),
    )
    con.commit()
    con.close()

    assert client.delete("/v1/me", headers=ORIGIN).status_code == 204
    assert client.get("/v1/me").status_code == 401
    con = sqlite3.connect(settings.db_path)
    assert con.execute("select count(*) from accounts").fetchone() == (0,)
    assert con.execute("select count(*) from sessions").fetchone() == (0,)
    assert con.execute("select account_id from comments").fetchone() == (None,)
    con.close()
    assert "blAs1N#3479" not in db_text(settings)


def test_the_site_may_send_the_session_cookie(client: TestClient) -> None:
    r = client.options(
        "/v1/me",
        headers={"Origin": "https://hpgg.win", "Access-Control-Request-Method": "DELETE"},
    )
    assert r.headers["access-control-allow-origin"] == "https://hpgg.win"
    assert r.headers["access-control-allow-credentials"] == "true"
    assert "DELETE" in r.headers["access-control-allow-methods"]

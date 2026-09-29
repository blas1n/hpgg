"""HTTP surface: validation, CORS, per-IP limits, error shapes, health, no token leaks."""

from __future__ import annotations

import json
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.config import Settings
from server.logs import configure_logging
from tests.server.conftest import TOKEN, Clock, FakeHP

URL = "/v1/players"
OK = {"battletag": "Player12#1012", "region": "NA"}


@pytest.fixture
def client(settings: Settings, fake_hp: FakeHP, clock: Clock) -> Iterator[TestClient]:
    app = create_app(settings, hp_transport=fake_hp.transport, clock=clock)
    with TestClient(app) as c:
        yield c


def test_healthz_reports_db_and_quota(client: TestClient) -> None:
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["quota"]["players"]["remaining"] is None  # nothing measured yet
    client.get(URL, params=OK)
    assert client.get("/healthz").json()["quota"]["players"]["remaining"] == 9999


def test_player_lookup(client: TestClient) -> None:
    r = client.get(URL, params=OK)
    assert r.status_code == 200
    body = r.json()
    assert body["player"]["account_level"] == 1802
    assert body["stale"] is False and body["notice"] is None
    assert body["fetched_at"].endswith("Z")
    assert r.headers["cache-control"].startswith("public, max-age=")


@pytest.mark.parametrize(
    "params",
    [
        {"battletag": "Zemill", "region": "NA"},
        {"battletag": "Zemill#abc", "region": "NA"},
        {"battletag": "Ze mill#1940", "region": "NA"},
        {"battletag": "Player12#1012", "region": "XX"},
        {"battletag": "Player12#1012"},
        {"battletag": "Player12#1012", "region": "NA", "season": "33"},
        {"battletag": "A" * 40 + "#1234", "region": "NA"},
    ],
)
def test_invalid_input_is_422_and_never_reaches_hp(
    client: TestClient, fake_hp: FakeHP, params: dict[str, str]
) -> None:
    r = client.get(URL, params=params)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_parameters"
    assert fake_hp.requests == []


def test_korean_battletag_and_region_ids(client: TestClient, fake_hp: FakeHP) -> None:
    r = client.get(URL, params={"battletag": "하늘바람#31234", "region": "KR"})
    assert r.status_code == 200
    assert fake_hp.requests[0].url.params["battletag"] == "하늘바람#31234"
    assert fake_hp.requests[0].url.params["region"] == "KR"


def test_not_found(client: TestClient, fake_hp: FakeHP) -> None:
    from tests.server.conftest import hp_response

    fake_hp.responder = lambda r: hp_response("v1_players_404.json")
    r = client.get(URL, params={"battletag": "Nobody#1234", "region": "KR"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "player_not_found"


def test_quota_exceeded_is_explicit(client: TestClient, fake_hp: FakeHP) -> None:
    fake_hp.responder = lambda r: httpx.Response(
        429,
        json={"error": {"code": "quota_exceeded", "message": "x"}},
        headers={"Retry-After": "120"},
    )
    r = client.get(URL, params=OK)
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "quota_exceeded"
    assert r.headers["retry-after"] == "120"


def test_upstream_unavailable_is_503(client: TestClient, fake_hp: FakeHP) -> None:
    fake_hp.responder = lambda r: httpx.Response(500, json={"error": {"code": "server_error"}})
    r = client.get(URL, params=OK)
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "upstream_unavailable"


def test_per_ip_rate_limit_uses_cf_connecting_ip(client: TestClient, settings: Settings) -> None:
    a = {"CF-Connecting-IP": "203.0.113.7"}
    for _ in range(settings.ip_requests_per_minute):
        assert client.get(URL, params=OK, headers=a).status_code == 200
    r = client.get(URL, params=OK, headers=a)
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "rate_limited"
    assert int(r.headers["retry-after"]) >= 1
    # another visitor behind the same tunnel is not affected
    assert client.get(URL, params=OK, headers={"CF-Connecting-IP": "198.51.100.1"}).is_success


def test_rate_limit_window_slides(client: TestClient, settings: Settings, clock: Clock) -> None:
    a = {"CF-Connecting-IP": "203.0.113.8"}
    for _ in range(settings.ip_requests_per_minute):
        client.get(URL, params=OK, headers=a)
    clock.now += 61
    assert client.get(URL, params=OK, headers=a).status_code == 200


def test_cors_allowlist(client: TestClient) -> None:
    ok = client.get(URL, params=OK, headers={"Origin": "https://hpgg.win"})
    assert ok.headers["access-control-allow-origin"] == "https://hpgg.win"
    dev = client.get(URL, params=OK, headers={"Origin": "http://localhost:5173"})
    assert dev.headers["access-control-allow-origin"] == "http://localhost:5173"
    evil = client.get(URL, params=OK, headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in evil.headers
    pre = client.options(
        URL,
        headers={"Origin": "https://hpgg.win", "Access-Control-Request-Method": "GET"},
    )
    assert pre.status_code == 200
    assert "POST" not in pre.headers["access-control-allow-methods"]


def test_token_and_authorization_never_logged_or_echoed(
    settings: Settings, fake_hp: FakeHP, clock: Clock, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging("DEBUG")
    app = create_app(settings, hp_transport=fake_hp.transport, clock=clock)
    bodies: list[str] = []
    responders = [
        lambda r: httpx.Response(500, json={"error": {"code": "server_error", "message": "x"}}),
        lambda r: httpx.Response(401, json={"error": {"code": "unauthenticated"}}),
        lambda r: httpx.Response(
            429, json={"error": {"code": "quota_exceeded"}}, headers={"Retry-After": "5"}
        ),
    ]

    def boom(r: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"refused {r.headers['Authorization']}")

    with TestClient(app) as c:
        for i, responder in enumerate([*responders, boom]):
            fake_hp.responder = responder
            clock.now += 10_000_000  # past any quota reset recorded by the previous case
            bodies.append(c.get(URL, params={"battletag": f"P{i}#1234", "region": "KR"}).text)
        bodies.append(c.get("/healthz").text)
    out = capsys.readouterr()
    everything = out.out + out.err + "".join(bodies)
    assert out.err.strip(), "expected JSON log lines on stderr"
    for line in out.err.strip().splitlines():
        json.loads(line)
    assert TOKEN not in everything
    assert "Bearer" not in everything
    # the tmp dir is named after this test, so drop it before looking for the header name
    assert "authorization" not in everything.replace(str(settings.db_path.parent), "").lower()
    assert TOKEN not in repr(settings)

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
OK = {"battletag": "Zemill#1940", "region": "NA"}


@pytest.fixture
def client(settings: Settings, fake_hp: FakeHP, clock: Clock) -> Iterator[TestClient]:
    # the privacy poller has its own test below; here it would add feed calls to fake_hp.requests
    app = create_app(settings, hp_transport=fake_hp.transport, clock=clock, privacy_poll=False)
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
        {"battletag": "Zemill#1940", "region": "XX"},
        {"battletag": "Zemill#1940"},
        {"battletag": "Zemill#1940", "region": "NA", "season": "33"},
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


def test_private_player_is_403_player_private(client: TestClient, fake_hp: FakeHP) -> None:
    from tests.server.conftest import hp_response

    fake_hp.responder = lambda r: hp_response("v1_players_403_private.json")
    r = client.get(URL, params={"battletag": "Razhag#2142", "region": "EU"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "player_private"
    assert "no-store" in r.headers["cache-control"]


def test_the_app_polls_the_privacy_feed_by_default(
    settings: Settings, fake_hp: FakeHP, clock: Clock
) -> None:
    import time

    from tests.server.conftest import hp_response

    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/players/privacy/changes"):
            return httpx.Response(
                200,
                json={
                    "changes": [
                        {
                            "battletag": "Razhag#2142",
                            "region": 2,
                            "state": "private",
                            "changed_at": "2026-10-01T00:00:00+00:00",
                        }
                    ],
                    "next_since": "2026-10-01T00:00:00+00:00",
                    "next_after_id": 1,
                    "has_more": False,
                },
            )
        return hp_response("v1_players_200.json")

    fake_hp.responder = answer
    with TestClient(create_app(settings, hp_transport=fake_hp.transport, clock=clock)) as c:
        deadline = time.monotonic() + 5
        while c.get("/healthz").json()["privacy"]["last_ok_at"] is None:
            assert time.monotonic() < deadline, "the feed was never polled"
            time.sleep(0.02)
        r = c.get(URL, params={"battletag": "Razhag#2142", "region": "EU"})
        assert r.status_code == 403
    players = [q for q in fake_hp.requests if q.url.path.endswith("/players")]
    assert players == []


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


def test_one_address_cannot_spend_the_day(
    client: TestClient, settings: Settings, clock: Clock
) -> None:
    """20 a minute is 28,800 a day: one address could spend the whole daily player budget
    (3,500) in three hours. A daily cap per address stops that (security review 2026-10-02)."""
    a = {"CF-Connecting-IP": "203.0.113.9"}
    for _ in range(settings.ip_requests_per_day):
        assert client.get(URL, params=OK, headers=a).status_code == 200
        clock.now += 61  # never the per-minute limit
    r = client.get(URL, params=OK, headers=a)
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "rate_limited"
    assert int(r.headers["retry-after"]) > 3600
    assert client.get(URL, params=OK, headers={"CF-Connecting-IP": "198.51.100.2"}).is_success
    clock.now += 86_400
    assert client.get(URL, params=OK, headers=a).status_code == 200


def test_healthz_through_the_tunnel_says_only_ok(client: TestClient) -> None:
    """The public /healthz showed every bucket's remaining quota; the full report is for the
    Mac mini itself (curl http://127.0.0.1:8800/healthz). Cloudflare always sets the header."""
    public = client.get("/healthz", headers={"CF-Connecting-IP": "203.0.113.10"})
    assert public.status_code == 200
    assert public.json() == {"ok": True}
    assert "quota" in client.get("/healthz").json()


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
    # comments are posted from the browser since 2026-10-05; nothing else writes, and other
    # origins are still refused (above)
    assert pre.headers["access-control-allow-methods"].replace(" ", "").split(",") == [
        "GET",
        "POST",
    ]


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


def test_match_list(client: TestClient, fake_hp: FakeHP) -> None:
    from tests.server.conftest import hp_response

    fake_hp.responder = lambda r: hp_response(
        "v1_players_matches_200.json"
        if r.url.path.endswith("/players/matches")
        else "v1_players_200.json"
    )
    r = client.get(URL + "/matches", params={"battletag": "blAs1N#3479", "region": "KR"})
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "full" and len(body["matches"]) == 3
    assert body["matches"][0]["kills"] == 9
    assert body["stale"] is False and body["fetched_at"].endswith("Z")
    assert r.headers["cache-control"].startswith("public, max-age=")
    health = client.get("/healthz").json()["quota"]
    assert health["player_match_history"]["live_calls_today"] == 1


@pytest.mark.parametrize(
    ("fixture", "status", "code"),
    [
        ("v1_players_404.json", 404, "player_not_found"),
        ("v1_players_403_private.json", 403, "player_private"),
    ],
)
def test_match_list_errors(
    client: TestClient, fake_hp: FakeHP, fixture: str, status: int, code: str
) -> None:
    from tests.server.conftest import hp_response

    fake_hp.responder = lambda r: hp_response(fixture)
    r = client.get(URL + "/matches", params={"battletag": "Nobody#1234", "region": "KR"})
    assert r.status_code == status and r.json()["error"]["code"] == code


def test_match_list_validates_like_the_profile(client: TestClient, fake_hp: FakeHP) -> None:
    r = client.get(URL + "/matches", params={"battletag": "Zemill", "region": "KR"})
    assert r.status_code == 422 and fake_hp.requests == []


def test_replay_in_full(client: TestClient, fake_hp: FakeHP) -> None:
    from tests.server.conftest import hp_response

    fake_hp.responder = lambda r: hp_response("v1_replay_200.json")
    r = client.get("/v1/replays/65597227")
    assert r.status_code == 200
    body = r.json()
    assert body["replay"]["map"] == "Hanamura Temple" and len(body["replay"]["teams"]) == 2
    assert body["fetched_at"].endswith("Z")
    assert r.headers["cache-control"].startswith("public, max-age=")
    assert client.get("/healthz").json()["quota"]["replay_data"]["live_calls_today"] == 1


@pytest.mark.parametrize("rid", ["abc", "0", "-5", "99999999999"])
def test_replay_id_is_validated(client: TestClient, fake_hp: FakeHP, rid: str) -> None:
    assert client.get(f"/v1/replays/{rid}").status_code == 422
    assert fake_hp.requests == []


def test_unknown_replay_is_404(client: TestClient, fake_hp: FakeHP) -> None:
    fake_hp.responder = lambda r: httpx.Response(404, json={"error": {"code": "not_found"}})
    r = client.get("/v1/replays/1")
    assert r.status_code == 404 and r.json()["error"]["code"] == "replay_not_found"


def test_team_luck(client: TestClient, fake_hp: FakeHP) -> None:
    """팀운 (#90): the newest games' teammates-minus-opponents MMR before each game."""
    from tests.server.conftest import hp_response

    def respond(r: httpx.Request) -> httpx.Response:
        if r.url.path.endswith("/players/matches"):
            return hp_response("v1_players_matches_200.json")
        if "/replay/" in r.url.path:
            return hp_response("v1_replay_200.json")
        return hp_response("v1_players_200.json")

    fake_hp.responder = respond
    r = client.get(URL + "/teamluck", params={"battletag": "blAs1N#3479", "region": "KR"})
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "all" and body["partial"] is False
    assert body["summary"]["games"] == 3 and isinstance(body["summary"]["gap_avg"], float)
    assert {"replay_id", "gap", "team_mmr", "opp_mmr", "win", "hero"} <= set(body["games"][0])
    assert body["formula"]["good"] == 50
    bad = client.get(URL + "/teamluck", params={"battletag": "x#1", "region": "KR", "games": 99})
    assert bad.status_code == 422

"""The Heroes Profile client: Bearer auth, quota headers, error envelopes. No retries."""

from __future__ import annotations

import httpx
import pytest

from server.players.hp import HPClient, Quota, parse_quota
from tests.server.conftest import BASE, TOKEN, Clock, FakeHP, hp_response


def _client(fake: FakeHP, clock: Clock) -> HPClient:
    return HPClient(
        base_url=BASE,
        token=TOKEN,
        http=httpx.AsyncClient(transport=fake.transport),
        clock=clock,
    )


def test_parse_quota_reset_is_seconds_from_now() -> None:
    q = parse_quota(
        httpx.Headers(
            {"X-HP-Quota-Limit": "10000", "X-HP-Quota-Remaining": "9999", "X-HP-Quota-Reset": "60"}
        ),
        now=1000.0,
    )
    assert q == Quota(limit=10000, remaining=9999, reset_at=1060.0)


@pytest.mark.parametrize(
    "headers",
    [{}, {"X-HP-Quota-Limit": "x", "X-HP-Quota-Remaining": "1", "X-HP-Quota-Reset": "1"}],
)
def test_parse_quota_missing_or_garbage(headers: dict[str, str]) -> None:
    assert parse_quota(httpx.Headers(headers), now=0.0) is None


async def test_sends_bearer_and_params_and_reads_quota(fake_hp: FakeHP, clock: Clock) -> None:
    up = await _client(fake_hp, clock).get(
        "/players", {"battletag": "Player12#1012", "region": "NA"}
    )
    req = fake_hp.requests[0]
    assert req.headers["Authorization"] == f"Bearer {TOKEN}"
    assert req.url.path == "/v1/players"
    assert req.url.params["battletag"] == "Player12#1012"
    assert "api_token" not in str(req.url)
    assert up.status == 200 and up.code is None
    assert up.body["account_level"] == 9485
    assert up.quota == Quota(limit=10000, remaining=9999, reset_at=clock.now + 604778)


async def test_not_found_envelope(fake_hp: FakeHP, clock: Clock) -> None:
    fake_hp.responder = lambda r: hp_response("v1_players_404.json")
    up = await _client(fake_hp, clock).get("/players", {"battletag": "No#1", "region": "KR"})
    assert (up.status, up.code) == (404, "player_not_found")


async def test_429_carries_retry_after(fake_hp: FakeHP, clock: Clock) -> None:
    fake_hp.responder = lambda r: httpx.Response(
        429,
        json={"error": {"code": "quota_exceeded", "message": "weekly allowance used"}},
        headers={"Retry-After": "3600"},
    )
    up = await _client(fake_hp, clock).get("/players", {})
    assert (up.status, up.code, up.retry_after) == (429, "quota_exceeded", 3600.0)


async def test_non_json_error(fake_hp: FakeHP, clock: Clock) -> None:
    fake_hp.responder = lambda r: httpx.Response(502, text="<html>bad gateway</html>")
    up = await _client(fake_hp, clock).get("/players", {})
    assert (up.status, up.code, up.body) == (502, "http_error", None)


async def test_transport_error_is_status_zero(fake_hp: FakeHP, clock: Clock) -> None:
    def boom(r: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    fake_hp.responder = boom
    up = await _client(fake_hp, clock).get("/players", {})
    assert (up.status, up.code) == (0, "transport_error")


def test_repr_hides_token(fake_hp: FakeHP, clock: Clock) -> None:
    assert TOKEN not in repr(_client(fake_hp, clock))

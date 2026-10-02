from __future__ import annotations

import httpx
import pytest
import respx
import structlog.testing

from collector.client import HPClient, HPError
from tests.conftest import BASE, TOKEN


def make_client(fake_sleep, **kw) -> HPClient:
    return HPClient(base_url=BASE, token=TOKEN, sleep=fake_sleep, **kw)


@respx.mock
async def test_sends_bearer_and_returns_json(fake_sleep) -> None:
    route = respx.get(f"{BASE}/heroes").mock(return_value=httpx.Response(200, json={"heroes": []}))
    async with make_client(fake_sleep) as c:
        body = await c.get_json("/heroes")
    assert body == {"heroes": []}
    assert route.calls[0].request.headers["authorization"] == f"Bearer {TOKEN}"
    assert route.calls[0].request.headers["accept"] == "application/json"


@respx.mock
async def test_202_is_followed_via_location_until_200(fake_sleep) -> None:
    respx.get(f"{BASE}/heroes/stats").mock(
        return_value=httpx.Response(
            202, json={"job_id": "j1"}, headers={"Location": f"{BASE}/jobs/j1", "Retry-After": "7"}
        )
    )
    job = respx.get(f"{BASE}/jobs/j1")
    job.side_effect = [
        httpx.Response(202, json={"status": "pending"}, headers={"Retry-After": "3"}),
        httpx.Response(200, json={"data": [1, 2]}),
    ]
    async with make_client(fake_sleep) as c:
        body = await c.get_json("/heroes/stats", params={"game_type": "qm"})
    assert body == {"data": [1, 2]}
    assert fake_sleep.calls == [7, 3]
    assert job.call_count == 2


@respx.mock
async def test_relative_location_is_resolved_against_base(fake_sleep) -> None:
    respx.get(f"{BASE}/heroes/stats").mock(
        return_value=httpx.Response(202, json={"job_id": "j2"}, headers={"Location": "/v1/jobs/j2"})
    )
    respx.get(f"{BASE}/jobs/j2").mock(return_value=httpx.Response(200, json={"ok": True}))
    async with make_client(fake_sleep) as c:
        assert await c.get_json("/heroes/stats") == {"ok": True}
    assert fake_sleep.calls == [10.0]  # default interval when Retry-After missing


@respx.mock
async def test_poll_gives_up_after_ceiling(fake_sleep) -> None:
    respx.get(f"{BASE}/heroes/stats").mock(
        return_value=httpx.Response(
            202, json={"job_id": "j3"}, headers={"Location": f"{BASE}/jobs/j3"}
        )
    )
    respx.get(f"{BASE}/jobs/j3").mock(return_value=httpx.Response(202, json={"status": "pending"}))
    clock = iter([0, 100, 500, 1000, 2000])
    async with make_client(fake_sleep, poll_max_seconds=900, clock=lambda: next(clock)) as c:
        with pytest.raises(HPError) as ei:
            await c.get_json("/heroes/stats")
    assert ei.value.code == "poll_timeout"


@respx.mock
async def test_failed_job_raises(fake_sleep) -> None:
    respx.get(f"{BASE}/heroes/stats").mock(
        return_value=httpx.Response(
            202, json={"job_id": "j4"}, headers={"Location": f"{BASE}/jobs/j4"}
        )
    )
    respx.get(f"{BASE}/jobs/j4").mock(
        return_value=httpx.Response(200, json={"status": "failed", "reason": "boom"})
    )
    async with make_client(fake_sleep) as c:
        with pytest.raises(HPError) as ei:
            await c.get_json("/heroes/stats")
    assert ei.value.code == "job_failed"


@respx.mock
async def test_error_envelope_becomes_hperror_without_retry(fake_sleep) -> None:
    route = respx.get(f"{BASE}/heroes/stats").mock(
        return_value=httpx.Response(
            422, json={"error": {"code": "timeframe_unavailable", "message": "nope"}}
        )
    )
    async with make_client(fake_sleep) as c:
        with pytest.raises(HPError) as ei:
            await c.get_json("/heroes/stats")
    assert (ei.value.status, ei.value.code) == (422, "timeframe_unavailable")
    assert route.call_count == 1


@respx.mock
async def test_429_waits_retry_after_then_retries_once(fake_sleep) -> None:
    route = respx.get(f"{BASE}/heroes/stats")
    route.side_effect = [
        httpx.Response(
            429,
            json={"error": {"code": "rate_limited", "message": "slow"}},
            headers={"Retry-After": "20"},
        ),
        httpx.Response(200, json={"ok": 1}),
    ]
    async with make_client(fake_sleep) as c:
        assert await c.get_json("/heroes/stats") == {"ok": 1}
    assert fake_sleep.calls == [20]
    assert route.call_count == 2


@respx.mock
async def test_429_twice_raises(fake_sleep) -> None:
    respx.get(f"{BASE}/heroes/stats").mock(
        return_value=httpx.Response(
            429,
            json={"error": {"code": "rate_limited", "message": "slow"}},
            headers={"Retry-After": "1"},
        )
    )
    async with make_client(fake_sleep) as c:
        with pytest.raises(HPError) as ei:
            await c.get_json("/heroes/stats")
    assert ei.value.code == "rate_limited"


@respx.mock
async def test_quota_exceeded_is_not_waited_out(fake_sleep) -> None:
    # A weekly allowance does not come back within Retry-After seconds (X-HP-Quota-Reset read
    # 578,105 s on 2026-09-29): sleeping on it would hang the Actions job until its timeout.
    route = respx.get(f"{BASE}/heroes/matchups").mock(
        return_value=httpx.Response(
            429,
            json={"error": {"code": "quota_exceeded", "message": "week"}},
            headers={"Retry-After": "578105"},
        )
    )
    async with make_client(fake_sleep) as c:
        with pytest.raises(HPError) as ei:
            await c.get_json("/heroes/matchups")
    assert ei.value.code == "quota_exceeded"
    assert route.call_count == 1
    assert fake_sleep.calls == []


@respx.mock
async def test_quota_remaining_header_is_logged(fake_sleep) -> None:
    respx.get(f"{BASE}/heroes/matchups").mock(
        return_value=httpx.Response(
            200,
            json={"ally": []},
            headers={"X-HP-Quota-Remaining": "612", "X-HP-Quota-Limit": "700"},
        )
    )
    with structlog.testing.capture_logs() as logs:
        async with make_client(fake_sleep) as c:
            await c.get_json("/heroes/matchups", params={"hero": "Abathur"})
    quota = [x for x in logs if x["event"] == "hp.quota"]
    assert quota == [
        {
            "event": "hp.quota",
            "log_level": "info",
            "path": "/v1/heroes/matchups",
            "remaining": 612,
            "limit": 700,
        }
    ]
    assert TOKEN not in str(logs)


@respx.mock
async def test_no_quota_header_no_quota_log(fake_sleep) -> None:
    respx.get(f"{BASE}/patches").mock(return_value=httpx.Response(200, json={}))
    with structlog.testing.capture_logs() as logs:
        async with make_client(fake_sleep) as c:
            await c.get_json("/patches")
    assert not [x for x in logs if x["event"] == "hp.quota"]


@respx.mock
async def test_5xx_retries_once_then_raises(fake_sleep) -> None:
    route = respx.get(f"{BASE}/heroes/stats").mock(
        return_value=httpx.Response(500, json={"error": {"code": "server_error", "message": "x"}})
    )
    async with make_client(fake_sleep) as c:
        with pytest.raises(HPError) as ei:
            await c.get_json("/heroes/stats")
    assert route.call_count == 2
    assert ei.value.status == 500


@respx.mock
async def test_transport_error_retries_once_then_succeeds(fake_sleep) -> None:
    route = respx.get(f"{BASE}/heroes/stats")
    route.side_effect = [httpx.ConnectError("boom"), httpx.Response(200, json={"ok": 2})]
    async with make_client(fake_sleep) as c:
        assert await c.get_json("/heroes/stats") == {"ok": 2}
    assert route.call_count == 2


@respx.mock
async def test_token_never_appears_in_error_text(fake_sleep) -> None:
    respx.get(f"{BASE}/heroes/stats").mock(
        return_value=httpx.Response(
            401, json={"error": {"code": "unauthenticated", "message": "no"}}
        )
    )
    async with make_client(fake_sleep) as c:
        with pytest.raises(HPError) as ei:
            await c.get_json("/heroes/stats")
    assert TOKEN not in str(ei.value)
    assert TOKEN not in repr(ei.value)
    assert TOKEN not in repr(c)


@respx.mock
async def test_the_job_url_is_logged_so_a_lost_result_can_be_fetched_again(fake_sleep) -> None:
    """2026-10-02: a run's results were lost with its runner; polling a job is free, so the
    job's URL in the log would have recovered them without spending the weekly quota."""
    respx.get(f"{BASE}/heroes/stats").mock(
        return_value=httpx.Response(
            202, json={"job_id": "j9"}, headers={"Location": f"{BASE}/jobs/j9", "Retry-After": "1"}
        )
    )
    respx.get(f"{BASE}/jobs/j9").mock(return_value=httpx.Response(200, json={"data": []}))
    with structlog.testing.capture_logs() as logs:
        async with make_client(fake_sleep) as c:
            await c.get_json("/heroes/stats", params={"game_type": "qm"})
    started = next(e for e in logs if e["event"] == "hp.job_started")
    assert started["job"] == f"{BASE}/jobs/j9"
    assert TOKEN not in str(logs)

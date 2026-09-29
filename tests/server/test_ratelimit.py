from __future__ import annotations

from starlette.requests import Request

from server.ratelimit import SlidingWindowLimiter, client_ip
from tests.server.conftest import Clock


def _req(headers: dict[str, str], client: tuple[str, int] | None) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw, "client": client})


def test_client_ip_prefers_cloudflare_header() -> None:
    assert client_ip(_req({"CF-Connecting-IP": " 203.0.113.9 "}, ("127.0.0.1", 1))) == "203.0.113.9"
    assert client_ip(_req({}, ("127.0.0.1", 1))) == "127.0.0.1"
    assert client_ip(_req({}, None)) == "unknown"


def test_retry_after_counts_down_to_the_oldest_hit() -> None:
    clock = Clock(1000.0)
    lim = SlidingWindowLimiter(2, 60.0, clock)
    assert lim.hit("a") is None
    clock.now += 10
    assert lim.hit("a") is None
    assert lim.hit("a") == 50.0


def test_idle_clients_are_pruned() -> None:
    clock = Clock(0.0)
    lim = SlidingWindowLimiter(1, 60.0, clock)
    for i in range(10_001):
        lim.hit(f"ip{i}")
    clock.now += 61
    lim.hit("fresh-1")
    lim.hit("fresh-2")
    assert set(lim._hits) == {"fresh-1", "fresh-2"}

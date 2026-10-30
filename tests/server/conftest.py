from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from server.app import create_app
from server.config import Settings
from tests.server.accounts_support import CLIENT_ID, CLIENT_SECRET, FakeBnet

FIXTURES = Path(__file__).parent / "fixtures"
BASE = "https://hp.test.invalid/v1"
TOKEN = "SECRET-TOKEN-srv987QWE"


def recorded(name: str) -> dict[str, Any]:
    """A real HP response recorded on 2026-09-29: {status, headers, body}."""
    data: dict[str, Any] = json.loads((FIXTURES / name).read_text())
    return data


def hp_response(name: str, **header_overrides: str) -> httpx.Response:
    rec = recorded(name)
    headers = {**rec["headers"], **header_overrides}
    return httpx.Response(rec["status"], json=rec["body"], headers=headers)


class Clock:
    def __init__(self, now: float = 1_790_000_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


class FakeHP:
    """httpx MockTransport handler: answers via `responder` and records every request."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.responder: Callable[[httpx.Request], httpx.Response] = lambda r: hp_response(
            "v1_players_200.json"
        )

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.responder(request)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def fake_hp() -> FakeHP:
    return FakeHP()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        hp_api_token=TOKEN,  # type: ignore[arg-type]
        hp_base_url=BASE,
        db_path=tmp_path / "hpgg.sqlite",
        cors_origins=["https://hpgg.win", "http://localhost:5173"],
        ip_requests_per_minute=5,
        ip_requests_per_day=12,
        daily_live_budget=100,
        quota_floor=10,
        _env_file=None,  # type: ignore[call-arg]
    )


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

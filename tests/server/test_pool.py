"""A member's hero pool (stage C, owner 2026-10-30): a list the member keeps by hand — any hero,
so a new player with no record can use it — plus a sync button that pulls this season's Storm
League record from Heroes Profile (the 이번 시즌 card's service) and adds the heroes played
`pool_min_games` times or more; heroes played fewer times come back as candidates to pick from.
Reading the pool never calls Heroes Profile; only a sync does."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import pytest
from fastapi.testclient import TestClient

from server.config import Settings
from server.players.season import SeasonLookup
from tests.server.accounts_support import ORIGIN, sign_in

URL = "/v1/me/pool"
SYNC = "/v1/me/pool/sync"


@dataclass
class FakeSeason:
    """Stands in for SeasonService: what HP knows about the member, and who asked."""

    result: SeasonLookup = field(
        default_factory=lambda: SeasonLookup(
            "ok",
            season=21,
            heroes=[
                {"hero": "Valla", "games": 31, "wins": 17},
                {"hero": "Li Li", "games": 12, "wins": 7},
                {"hero": "Lúcio", "games": 5, "wins": 2},
                {"hero": "Zeratul", "games": 4, "wins": 3},
                {"hero": "Abathur", "games": 1, "wins": 0},
            ],
        )
    )
    asked: list[tuple[str, str]] = field(default_factory=list)

    async def lookup(self, battletag: str, region: str) -> SeasonLookup:
        self.asked.append((battletag, region))
        return self.result


@pytest.fixture
def season() -> FakeSeason:
    return FakeSeason()


@pytest.fixture
def signed_in(make_client: Callable[..., TestClient], season: FakeSeason) -> TestClient:
    c = make_client()
    c.app.state.season = season  # type: ignore[attr-defined]
    sign_in(c)
    return c


@pytest.fixture
def member(signed_in: TestClient) -> TestClient:
    assert signed_in.post("/v1/me/region", json={"region": "KR"}, headers=ORIGIN).status_code == 204
    return signed_in


def pool(c: TestClient) -> list[str]:
    r = c.get(URL)
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    return [h["hero"] for h in r.json()["heroes"]]


def add(c: TestClient, hero: str, include: bool = True) -> int:
    return c.post(URL, json={"hero": hero, "in": include}, headers=ORIGIN).status_code


def test_a_new_member_starts_empty_and_picks_any_hero_without_a_record(
    signed_in: TestClient, season: FakeSeason
) -> None:
    # no region, no record needed: a new player builds the pool by hand
    assert pool(signed_in) == []
    assert add(signed_in, "Anduin") == 204
    assert add(signed_in, "Li-Ming") == 204
    assert add(signed_in, "Anduin") == 204  # twice is still once
    assert pool(signed_in) == ["Anduin", "Li-Ming"]
    assert add(signed_in, "Anduin", include=False) == 204
    assert pool(signed_in) == ["Li-Ming"]
    assert signed_in.delete(URL, headers=ORIGIN).status_code == 204
    assert pool(signed_in) == []
    assert season.asked == []  # reading and editing the pool never asks Heroes Profile


def test_sync_adds_this_seasons_heroes_and_offers_the_rest_as_candidates(
    member: TestClient, season: FakeSeason
) -> None:
    add(member, "Anduin")
    r = member.post(SYNC, headers=ORIGIN)
    assert r.status_code == 200
    body: dict[str, Any] = r.json()
    assert body["status"] == "ok" and body["season"] == 21 and body["min_games"] == 5
    assert body["added"] == ["Valla", "Li Li", "Lúcio"]
    # their record too, so the page can say "이번 시즌 31판" on each (owner's mock)
    assert body["added_records"] == [
        {"hero": "Valla", "games": 31, "wins": 17},
        {"hero": "Li Li", "games": 12, "wins": 7},
        {"hero": "Lúcio", "games": 5, "wins": 2},
    ]
    assert body["candidates"] == [
        {"hero": "Zeratul", "games": 4, "wins": 3},
        {"hero": "Abathur", "games": 1, "wins": 0},
    ]
    assert season.asked == [("blAs1N#3479", "KR")]  # the member's own BattleTag and region
    # added to what was there, nothing taken away; the list keeps the order heroes came in
    assert pool(member) == ["Anduin", "Valla", "Li Li", "Lúcio"]

    # a second sync adds nothing new and says so
    again = member.post(SYNC, headers=ORIGIN).json()
    assert again["added"] == [] and again["added_records"] == []
    assert pool(member) == ["Anduin", "Valla", "Li Li", "Lúcio"]


def test_a_hero_removed_by_hand_comes_back_only_on_the_next_sync(member: TestClient) -> None:
    member.post(SYNC, headers=ORIGIN)
    add(member, "Li Li", include=False)
    assert "Li Li" not in pool(member)
    assert member.post(SYNC, headers=ORIGIN).json()["added"] == ["Li Li"]


def test_sync_without_a_record_changes_nothing_and_says_why(
    member: TestClient, season: FakeSeason
) -> None:
    add(member, "Anduin")
    for outcome in ["private", "not_found", "quota_exceeded", "unavailable"]:
        season.result = SeasonLookup(outcome)
        body = member.post(SYNC, headers=ORIGIN).json()
        assert body["status"] == outcome and body["added"] == [] and body["candidates"] == []
    assert pool(member) == ["Anduin"]


def test_a_stale_record_still_syncs_and_says_so(member: TestClient, season: FakeSeason) -> None:
    season.result = SeasonLookup(
        "ok", season=21, heroes=[{"hero": "Valla", "games": 9, "wins": 4}], stale=True
    )
    body = member.post(SYNC, headers=ORIGIN).json()
    assert body["stale"] is True and body["added"] == ["Valla"]


def test_sync_needs_a_region_and_a_sign_in(
    make_client: Callable[..., TestClient], signed_in: TestClient, season: FakeSeason
) -> None:
    r = signed_in.post(SYNC, headers=ORIGIN)
    assert r.status_code == 409 and r.json()["error"]["code"] == "region_required"
    stranger = make_client()
    assert stranger.get(URL).status_code == 401
    assert stranger.post(SYNC, headers=ORIGIN).status_code == 401
    assert season.asked == []


def test_bad_hero_names_and_other_sites_are_refused(member: TestClient) -> None:
    for bad in ["", "x" * 41, "<script>", "Valla\nZeratul", "1abc"]:
        assert add(member, bad) == 422, bad
    evil = {"Origin": "https://evil.example"}
    assert member.post(URL, json={"hero": "Valla", "in": True}, headers=evil).status_code == 403
    assert member.post(SYNC, headers=evil).status_code == 403
    assert member.delete(URL, headers=evil).status_code == 403


def test_the_pool_goes_with_the_account(member: TestClient, settings: Settings) -> None:
    add(member, "Zeratul")
    assert member.delete("/v1/me", headers=ORIGIN).status_code == 204
    con = sqlite3.connect(settings.db_path)
    assert con.execute("select count(*) from hero_pool").fetchone() == (0,)
    con.close()

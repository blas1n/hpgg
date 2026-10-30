"""A member's hero pool (stage C, owner 2026-10-30): the Storm League heroes they played this
season (HP via the 이번 시즌 card's service, `pool_min_games` or more), plus heroes they add and
minus heroes they take out. What they set by hand is never overwritten by the record, and stays
when HP has nothing (private, no uploads, quota)."""

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
def member(make_client: Callable[..., TestClient], season: FakeSeason) -> TestClient:
    c = make_client()
    c.app.state.season = season  # type: ignore[attr-defined]
    sign_in(c)
    assert c.post("/v1/me/region", json={"region": "KR"}, headers=ORIGIN).status_code == 204
    return c


def names(body: dict[str, Any], key: str = "heroes") -> list[str]:
    return [h["hero"] for h in body[key]]


def test_the_pool_is_this_seasons_heroes_played_often_enough(
    member: TestClient, season: FakeSeason
) -> None:
    r = member.get(URL)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["season"] == 21 and body["min_games"] == 5
    assert names(body) == ["Valla", "Li Li", "Lúcio"]  # Zeratul: 4 games, under the line
    assert body["heroes"][0] == {"hero": "Valla", "games": 31, "wins": 17, "origin": "record"}
    assert body["removed"] == []
    assert season.asked == [("blAs1N#3479", "KR")]  # the member's own BattleTag and region
    assert r.headers["cache-control"] == "no-store"


def test_heroes_added_and_taken_out_by_hand(member: TestClient) -> None:
    assert member.post(URL, json={"hero": "Zeratul", "in": True}, headers=ORIGIN).status_code == 204
    assert member.post(URL, json={"hero": "Li Li", "in": False}, headers=ORIGIN).status_code == 204
    assert member.post(URL, json={"hero": "Anduin", "in": True}, headers=ORIGIN).status_code == 204
    body = member.get(URL).json()
    assert names(body) == ["Valla", "Lúcio", "Anduin", "Zeratul"]  # the record, then added by name
    assert {h["hero"]: h["origin"] for h in body["heroes"]}["Zeratul"] == "added"
    # an added hero carries its record when HP has one, zeros otherwise
    assert [h for h in body["heroes"] if h["hero"] == "Anduin"][0]["games"] == 0
    # a hero taken out is listed apart, so the page can put it back
    assert names(body, "removed") == ["Li Li"]

    # putting it back, and the reset
    member.post(URL, json={"hero": "Li Li", "in": True}, headers=ORIGIN)
    assert "Li Li" in names(member.get(URL).json())
    assert member.delete(URL, headers=ORIGIN).status_code == 204
    assert names(member.get(URL).json()) == ["Valla", "Li Li", "Lúcio"]


def test_what_was_set_by_hand_survives_when_hp_has_nothing(
    member: TestClient, season: FakeSeason
) -> None:
    member.post(URL, json={"hero": "Valla", "in": True}, headers=ORIGIN)
    member.post(URL, json={"hero": "Li Li", "in": False}, headers=ORIGIN)
    for outcome in ["private", "not_found", "quota_exceeded", "unavailable"]:
        season.result = SeasonLookup(outcome)
        body = member.get(URL).json()
        assert body["status"] == outcome
        assert names(body) == ["Valla"]  # only what the member chose; nothing from HP
        assert body["heroes"][0]["origin"] == "added"


def test_a_stale_answer_is_used_and_says_so(member: TestClient, season: FakeSeason) -> None:
    season.result = SeasonLookup(
        "ok", season=21, heroes=[{"hero": "Valla", "games": 9, "wins": 4}], stale=True
    )
    body = member.get(URL).json()
    assert body["stale"] is True and names(body) == ["Valla"]


def test_the_region_comes_first(make_client: Callable[..., TestClient], season: FakeSeason) -> None:
    c = make_client()
    c.app.state.season = season  # type: ignore[attr-defined]
    assert c.get(URL).status_code == 401
    sign_in(c)
    r = c.get(URL)
    assert r.status_code == 409 and r.json()["error"]["code"] == "region_required"
    assert season.asked == []  # no HP call without a region


def test_bad_hero_names_and_other_sites_are_refused(member: TestClient) -> None:
    for bad in ["", "x" * 41, "<script>", "Valla\nZeratul"]:
        r = member.post(URL, json={"hero": bad, "in": True}, headers=ORIGIN)
        assert r.status_code == 422, bad
    evil = {"Origin": "https://evil.example"}
    assert member.post(URL, json={"hero": "Valla", "in": True}, headers=evil).status_code == 403
    assert member.delete(URL, headers=evil).status_code == 403


def test_the_pool_goes_with_the_account(member: TestClient, settings: Settings) -> None:
    member.post(URL, json={"hero": "Zeratul", "in": True}, headers=ORIGIN)
    assert member.delete("/v1/me", headers=ORIGIN).status_code == 204
    con = sqlite3.connect(settings.db_path)
    assert con.execute("select count(*) from hero_pool").fetchone() == (0,)
    con.close()

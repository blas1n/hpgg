"""Talent picks of the heroes a weekly report cites (owner 2026-10-05: a new hero's report has to
say which talents players settle on and what that tells). HP /heroes/talents/details answers one
hero per call, every talent per level with games, popularity and win rate (live probe, 10-05,
Xal'atath Storm League 2.57.0: Anchored Core 73 % at level 1, winning 70.9 %)."""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from collector.config import Settings
from collector.run import _client
from collector.talent_details import collect_talent_details, fetch_weekly_talents, normalize
from tests.conftest import BASE, TOKEN
from tests.test_evidence import _data

PROBE = Path(__file__).parent / "fixtures" / "live_probe_talent_details_xalatath_sl_2.57.0.json.gz"


def _probe() -> dict[str, Any]:
    with gzip.open(PROBE, "rt", encoding="utf-8") as f:
        return json.load(f)


def _settings(tmp_path: Path, data_dir: Path | None = None) -> Settings:
    return Settings(
        _env_file=None,
        hp_api_token=TOKEN,
        hp_base_url=BASE,
        data_dir=data_dir or tmp_path / "data",
        tmp_dir=tmp_path / "tmp",
        snapshot_out_dir=tmp_path / "snap",
    )  # type: ignore[call-arg]


def test_each_level_lists_its_talents_most_played_first() -> None:
    levels = normalize(_probe())
    assert list(levels) == ["1", "4", "7", "10", "13", "16", "20"]
    first = levels["1"][0]
    assert first == {
        "talent": "XalatathAnchoredCore",
        "games": 1307,
        "wins": 926,
        "popularity": 73.34,
        "win_rate": 70.85,
    }
    assert [t["talent"] for t in levels["10"]] == [
        "XalatathHeroicAbilityVoidEruption",
        "XalatathHeroicAbilityVoidConvergence",
    ]


@respx.mock
async def test_one_call_per_hero_on_storm_league_and_a_failed_hero_is_left_out(
    tmp_path: Path, fake_sleep: Any
) -> None:
    asked: list[dict[str, str]] = []

    def details(request: httpx.Request) -> httpx.Response:
        q = dict(httpx.QueryParams(request.url.query))
        asked.append(q)
        if q["hero"] == "Tyrael":
            return httpx.Response(500, json={"error": {"code": "server_error", "message": "x"}})
        return httpx.Response(200, json=_probe())

    respx.get(f"{BASE}/heroes/talents/details").mock(side_effect=details)
    s = _settings(tmp_path)
    out = await collect_talent_details(
        _client(s, fake_sleep),
        s,
        heroes=["Xal'atath", "Tyrael"],
        patch="2.57.0",
        timeframe="1,2,3,4,5,6",
        collected_at="2026-10-12T03:20:00Z",
        sleep=fake_sleep,
    )
    # one hero per call, in order (the client retries a 500 itself)
    assert list(dict.fromkeys(q["hero"] for q in asked)) == ["Xal'atath", "Tyrael"]
    assert all(
        q["game_type"] == "sl" and q["timeframe_type"] == "minor" and q["timeframe"] == "2,3,4,5,6"
        for q in asked
    )
    assert out["patch"] == "2.57.0" and out["game_type"] == "sl"
    assert list(out["heroes"]) == ["Xal'atath"]  # Tyrael failed: left out, the rest kept
    assert out["heroes"]["Xal'atath"]["1"][0]["talent"] == "XalatathAnchoredCore"


@respx.mock
async def test_a_spent_allowance_stops_asking(tmp_path: Path, fake_sleep: Any) -> None:
    route = respx.get(f"{BASE}/heroes/talents/details").mock(
        return_value=httpx.Response(429, json={"error": {"code": "quota_exceeded", "message": "x"}})
    )
    s = _settings(tmp_path)
    out = await collect_talent_details(
        _client(s, fake_sleep),
        s,
        heroes=["Xal'atath", "Tyrael", "Diablo"],
        patch="2.57.0",
        timeframe="1",
        collected_at="c",
        sleep=fake_sleep,
    )
    assert route.call_count == 1 and out["heroes"] == {}


@respx.mock
async def test_a_new_issue_gets_the_talents_of_the_heroes_its_evidence_cites(
    tmp_path: Path, fake_sleep: Any
) -> None:
    data = _data(tmp_path)  # 2026-w40: Xal'atath the centre, Tyrael and Diablo findings
    route = respx.get(f"{BASE}/heroes/talents/details").mock(
        return_value=httpx.Response(200, json=_probe())
    )
    s = _settings(tmp_path, data)
    await fetch_weekly_talents(
        _client(s, fake_sleep),
        s,
        weeks=["2026-w40"],
        patch="2.57.0",
        timeframe="1,2",
        collected_at="2026-10-05T18:20:00Z",
        sleep=fake_sleep,
    )
    out = json.loads((data / "weekly" / "2026-w40.talents.json").read_text())
    asked = [dict(httpx.QueryParams(c.request.url.query))["hero"] for c in route.calls]
    assert asked[0] == "Xal'atath" and {"Tyrael", "Diablo"} <= set(asked)
    assert set(out["heroes"]) == set(asked)
    # written once: a later run asks nothing
    await fetch_weekly_talents(
        _client(s, fake_sleep),
        s,
        weeks=["2026-w40"],
        patch="2.57.0",
        timeframe="1,2",
        collected_at="later",
        sleep=fake_sleep,
    )
    assert route.call_count == len(asked)


@respx.mock
async def test_an_issue_of_another_patch_gets_none(tmp_path: Path, fake_sleep: Any) -> None:
    data = _data(tmp_path)
    route = respx.get(f"{BASE}/heroes/talents/details").mock(
        return_value=httpx.Response(200, json=_probe())
    )
    s = _settings(tmp_path, data)
    await fetch_weekly_talents(
        _client(s, fake_sleep),
        s,
        weeks=["2026-w40"],
        patch="2.58.0",
        timeframe="1",
        collected_at="c",
        sleep=fake_sleep,
    )
    assert route.call_count == 0
    assert not (data / "weekly" / "2026-w40.talents.json").exists()


@pytest.mark.parametrize("weeks", [[], ["2026-w39"]])
@respx.mock
async def test_nothing_to_fetch_without_an_issue(
    tmp_path: Path, fake_sleep: Any, weeks: list[str]
) -> None:
    data = _data(tmp_path)
    route = respx.get(f"{BASE}/heroes/talents/details").mock(
        return_value=httpx.Response(200, json=_probe())
    )
    s = _settings(tmp_path, data)
    await fetch_weekly_talents(
        _client(s, fake_sleep),
        s,
        weeks=weeks,
        patch="2.57.0",
        timeframe="1",
        collected_at="c",
        sleep=fake_sleep,
    )
    assert route.call_count == 0

"""Storm League average stats per hero (주간 메타 리포트, owner 2026-10-05): HP /heroes/stats with
`statfilter` answers each hero's average per game in `total_filter_type` (checked live 10-05:
Xal'atath hero_damage 72,730, first of 91). One call per stat, so a few a week."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from collector.averages import STATS, collect_averages, due, last_builds
from collector.client import HPError
from collector.config import Settings
from collector.run import _client
from tests.conftest import BASE, TOKEN


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,
        hp_api_token=TOKEN,
        hp_base_url=BASE,
        data_dir=tmp_path / "data",
        tmp_dir=tmp_path / "tmp",
        snapshot_out_dir=tmp_path / "snap",
    )  # type: ignore[call-arg]


def _answer(stat: str) -> dict[str, Any]:
    base = {
        "hero_damage": 70000.0,
        "healing": 1000.0,
        "damage_taken": 50000.0,
        "deaths": 4.0,
        "siege_damage": 90000.0,
    }[stat]
    return {
        "average_total_filter_type": base / 2,
        "data": [
            {"name": "Xal'atath", "games_played": 1759, "total_filter_type": base},
            {"name": "Tyrael", "games_played": 1200, "total_filter_type": base / 2},
        ],
    }


def test_at_most_the_five_newest_builds() -> None:
    assert last_builds("a,b,c") == "a,b,c"
    assert last_builds("1,2,3,4,5,6,7") == "3,4,5,6,7"


@respx.mock
async def test_each_stat_is_one_call_and_the_answers_are_kept_per_hero(
    tmp_path: Path, fake_sleep: Any
) -> None:
    asked: list[dict[str, str]] = []

    def stats(request: httpx.Request) -> httpx.Response:
        q = dict(httpx.QueryParams(request.url.query))
        asked.append(q)
        return httpx.Response(200, json=_answer(q["statfilter"]))

    respx.get(f"{BASE}/heroes/stats").mock(side_effect=stats)
    s = _settings(tmp_path)
    out = await collect_averages(
        _client(s, fake_sleep),
        s,
        patch="2.57.0",
        timeframe="1,2,3,4,5,6",
        collected_at="2026-10-12T03:20:00Z",
        sleep=fake_sleep,
    )
    assert [q["statfilter"] for q in asked] == list(STATS)
    assert all(
        q["game_type"] == "sl"
        and q["timeframe"] == "2,3,4,5,6"
        and q["timeframe_type"] == "minor"
        and "group_by_map" not in q
        for q in asked
    )
    assert out["patch"] == "2.57.0" and out["game_type"] == "sl"
    assert out["stats"]["hero_damage"]["Xal'atath"] == 70000.0
    assert out["average"]["deaths"] == 2.0
    assert out["games"]["Tyrael"] == 1200


def test_due_once_a_week_or_on_a_new_patch(tmp_path: Path) -> None:
    p = tmp_path / "sl_averages.json"
    assert due(p, patch="2.57.0", collected_at="2026-10-12T03:20:00Z")
    p.write_text(json.dumps({"patch": "2.57.0", "collected_at": "2026-10-08T03:20:00Z"}))
    assert not due(p, patch="2.57.0", collected_at="2026-10-12T03:20:00Z")  # 4 days
    assert due(p, patch="2.57.0", collected_at="2026-10-15T03:20:00Z")  # 7 days
    assert due(p, patch="2.58.0", collected_at="2026-10-09T03:20:00Z")  # a new patch


@respx.mock
async def test_a_failed_stat_fails_the_whole_set(tmp_path: Path, fake_sleep: Any) -> None:
    def stats(request: httpx.Request) -> httpx.Response:
        q = dict(httpx.QueryParams(request.url.query))
        if q["statfilter"] == "healing":
            return httpx.Response(500, json={"error": {"code": "server_error", "message": "x"}})
        return httpx.Response(200, json=_answer(q["statfilter"]))

    respx.get(f"{BASE}/heroes/stats").mock(side_effect=stats)
    s = _settings(tmp_path)
    with pytest.raises(HPError):
        await collect_averages(
            _client(s, fake_sleep),
            s,
            patch="2.57.0",
            timeframe="1,2",
            collected_at="c",
            sleep=fake_sleep,
        )

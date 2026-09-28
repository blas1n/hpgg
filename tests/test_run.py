from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import httpx
import respx

from collector.config import Settings
from collector.run import run
from tests.conftest import BASE, TOKEN


def settings(tmp_path: Path, **kw: Any) -> Settings:
    return Settings(
        _env_file=None,
        hp_api_token=TOKEN,
        hp_base_url=BASE,
        data_dir=tmp_path / "data",
        tmp_dir=tmp_path / "tmp",
        snapshot_out_dir=tmp_path / "snap",
        **kw,
    )


def mock_api(
    raw_by_map: dict[str, Any], patches: dict[str, Any], fail_key: str | None = None
) -> None:
    respx.get(f"{BASE}/patches").mock(return_value=httpx.Response(200, json=patches))

    def stats(request: httpx.Request) -> httpx.Response:
        q = dict(httpx.QueryParams(request.url.query))
        assert q["group_by_map"] == "true"
        assert q["timeframe_type"] == "minor" and q["timeframe"] == "2.55.17.97771"
        if fail_key == "sl_high" and q.get("league_tier") == "6":
            return httpx.Response(500, json={"error": {"code": "server_error", "message": "x"}})
        return httpx.Response(200, json=raw_by_map)

    respx.get(f"{BASE}/heroes/stats").mock(side_effect=stats)
    respx.get(f"{BASE}/heroes/talents/builds/all").mock(
        return_value=httpx.Response(200, json={"Nova": []})
    )


@respx.mock
async def test_run_writes_five_files_meta_and_raw_gz(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    s = settings(tmp_path)
    code = await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T01:02:03Z")
    assert code == 0
    latest = s.data_dir / "latest"
    assert sorted(p.name for p in latest.iterdir()) == [
        "builds.json",
        "meta.json",
        "qm.json",
        "sl.json",
        "sl_high.json",
        "sl_low.json",
        "sl_mid.json",
    ]
    meta = json.loads((latest / "meta.json").read_text())
    assert (
        meta["current_patch"] == "2.55.17.97771" and meta["collected_at"] == "2026-09-28T01:02:03Z"
    )
    assert set(meta["modes"]) == {"qm", "sl", "sl_low", "sl_mid", "sl_high"}
    # raw responses kept gzipped for the snapshots branch
    day = s.snapshot_out_dir / "2026-09-28"
    assert sorted(p.name for p in day.iterdir()) == [
        "builds.json.gz",
        "meta.json",
        "qm.json.gz",
        "raw_builds.json.gz",
        "raw_qm.json.gz",
        "raw_sl.json.gz",
        "raw_sl_high.json.gz",
        "raw_sl_low.json.gz",
        "raw_sl_mid.json.gz",
        "sl.json.gz",
        "sl_high.json.gz",
        "sl_low.json.gz",
        "sl_mid.json.gz",
    ]
    # 60 s spacing between the five group_by_map calls → 4 waits, + 1 before builds/all
    assert fake_sleep.calls == [60.0] * 5


@respx.mock
async def test_run_passes_league_tier_and_game_type_per_spec(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    await run(settings(tmp_path), sleep=fake_sleep, now=lambda: "t")
    calls = [
        dict(httpx.QueryParams(c.request.url.query))
        for c in respx.calls
        if c.request.url.path.endswith("/heroes/stats")
    ]
    assert [(c["game_type"], c.get("league_tier")) for c in calls] == [
        ("qm", None),
        ("sl", None),
        ("sl", "1,2,3"),
        ("sl", "4,5"),
        ("sl", "6"),
    ]


@respx.mock
async def test_run_failure_leaves_latest_untouched_and_exits_nonzero(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    before = {p.name: p.read_bytes() for p in (s.data_dir / "latest").iterdir()}
    respx.reset()
    mock_api(raw_by_map, patches_payload, fail_key="sl_high")
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-29T00:00:00Z") == 1
    after = {p.name: p.read_bytes() for p in (s.data_dir / "latest").iterdir()}
    assert after == before


@respx.mock
async def test_run_never_logs_the_token(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep, capsys, caplog
) -> None:
    respx.get(f"{BASE}/patches").mock(
        return_value=httpx.Response(
            401, json={"error": {"code": "unauthenticated", "message": "bad key"}}
        )
    )
    with caplog.at_level(logging.DEBUG):
        code = await run(settings(tmp_path), sleep=fake_sleep, now=lambda: "t")
    assert code == 1
    out = capsys.readouterr()
    assert TOKEN not in out.out and TOKEN not in out.err and TOKEN not in caplog.text


@respx.mock
async def test_run_keeps_previous_patch_data_on_patch_change(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    respx.reset()
    newer = json.loads(json.dumps(patches_payload))
    newer["patches"].append({"game_version": "2.55.18.99000", "valid_globals": True})
    respx.get(f"{BASE}/patches").mock(return_value=httpx.Response(200, json=newer))

    def stats(request: httpx.Request) -> httpx.Response:
        assert dict(httpx.QueryParams(request.url.query))["timeframe"] == "2.55.18.99000"
        return httpx.Response(200, json=raw_by_map)

    respx.get(f"{BASE}/heroes/stats").mock(side_effect=stats)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-10-02T00:00:00Z") == 0
    meta = json.loads((s.data_dir / "latest" / "meta.json").read_text())
    assert (meta["current_patch"], meta["previous_patch"], meta["patch_started_at"]) == (
        "2.55.18.99000",
        "2.55.17.97771",
        "2026-10-02",
    )
    assert json.loads((s.data_dir / "previous" / "qm.json").read_text())["patch"] == "2.55.17.97771"


def test_main_module_exists() -> None:
    import collector.__main__  # noqa: F401

    assert callable(collector.__main__.main)


@respx.mock
async def test_backfill_previous_writes_previous_and_meta_without_touching_latest(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    """`--previous <build>` collects an older build into data/previous/ and records it in meta."""
    from collector.run import run_backfill_previous

    mock_api(raw_by_map, patches_payload)
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    before = {
        p.name: p.read_bytes() for p in (s.data_dir / "latest").iterdir() if p.name != "meta.json"
    }
    respx.reset()

    def stats(request: httpx.Request) -> httpx.Response:
        assert dict(httpx.QueryParams(request.url.query))["timeframe"] == "2.55.17.97650"
        return httpx.Response(200, json=raw_by_map)

    respx.get(f"{BASE}/heroes/stats").mock(side_effect=stats)
    code = await run_backfill_previous(
        s, patch="2.55.17.97650", sleep=fake_sleep, now=lambda: "2026-09-28T01:00:00Z"
    )
    assert code == 0
    prev = s.data_dir / "previous"
    assert sorted(p.name for p in prev.iterdir()) == [
        "qm.json",
        "sl.json",
        "sl_high.json",
        "sl_low.json",
        "sl_mid.json",
    ]
    assert json.loads((prev / "qm.json").read_text())["patch"] == "2.55.17.97650"
    meta = json.loads((s.data_dir / "latest" / "meta.json").read_text())
    assert meta["previous_patch"] == "2.55.17.97650" and meta["current_patch"] == "2.55.17.97771"
    after = {
        p.name: p.read_bytes() for p in (s.data_dir / "latest").iterdir() if p.name != "meta.json"
    }
    assert after == before  # latest untouched


@respx.mock
async def test_backfill_refuses_the_current_patch_and_needs_latest(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    from collector.run import run_backfill_previous

    s = settings(tmp_path)
    mock_api(raw_by_map, patches_payload)
    # no latest yet → refuse
    assert (
        await run_backfill_previous(s, patch="2.55.17.97650", sleep=fake_sleep, now=lambda: "t")
        == 2
    )
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    # same build as current → refuse
    assert (
        await run_backfill_previous(s, patch="2.55.17.97771", sleep=fake_sleep, now=lambda: "t")
        == 2
    )


def _builds_payload() -> dict[str, Any]:
    def talent(lvl: int, name: str, title: str) -> dict[str, Any]:
        return {"talent_id": 1, "title": title, "talent_name": name, "level": lvl, "icon": "i.png"}

    build = {
        "hero": {"name": "Illidan"},
        "level_one": talent(1, "IllidanUnendingHatredPassive", "Unending Hatred"),
        "level_four": talent(4, "IllidanRapidChase", "Rapid Chase"),
        "level_seven": talent(7, "IllidanReflexiveBlock", "Reflexive Block"),
        "level_ten": talent(10, "IllidanMetamorphosis", "Metamorphosis"),
        "level_thirteen": talent(13, "IllidanElusiveStrikes", "Elusive Strikes"),
        "level_sixteen": talent(16, "IllidanFieryBrand", "Fiery Brand"),
        "level_twenty": talent(20, "IllidanNexusBlades", "Nexus Blades"),
        "games_played": 386,
        "buildData": {},
        "win_rate": 51.3,
        "total_filter_type": 0,
    }
    return {"Illidan": [build, {**build, "games_played": 120, "win_rate": 48.0}], "Nova": []}


@respx.mock
async def test_run_collects_popular_builds_after_stats(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    route = respx.get(f"{BASE}/heroes/talents/builds/all").mock(
        return_value=httpx.Response(200, json=_builds_payload())
    )
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    q = dict(httpx.QueryParams(route.calls[0].request.url.query))
    assert (q["timeframe"], q["game_type"], q["talentbuildtype"], q["total_builds"]) == (
        "2.55.17.97771",
        "qm,sl",
        "Popular",
        "5",
    )
    b = json.loads((s.data_dir / "latest" / "builds.json").read_text())
    assert b["patch"] == "2.55.17.97771" and b["game_type"] == "qm,sl"
    assert [x["games"] for x in b["heroes"]["Illidan"]] == [386, 120]
    assert b["heroes"]["Illidan"][0]["win_rate"] == 51.3
    assert [t["level"] for t in b["heroes"]["Illidan"][0]["talents"]] == [1, 4, 7, 10, 13, 16, 20]
    assert b["heroes"]["Illidan"][0]["talents"][0] == {
        "level": 1,
        "name": "IllidanUnendingHatredPassive",
        "title": "Unending Hatred",
    }
    assert b["heroes"]["Nova"] == []
    assert fake_sleep.calls == [60.0] * 5  # 4 between stats + 1 before builds (1 req/min)
    assert (s.snapshot_out_dir / "2026-09-28" / "raw_builds.json.gz").exists()


@respx.mock
async def test_builds_quota_exceeded_keeps_yesterdays_file_and_still_succeeds(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    respx.get(f"{BASE}/heroes/talents/builds/all").mock(
        return_value=httpx.Response(200, json=_builds_payload())
    )
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    respx.get(f"{BASE}/heroes/talents/builds/all").mock(
        return_value=httpx.Response(
            429,
            json={"error": {"code": "quota_exceeded", "message": "week"}},
            headers={"Retry-After": "1"},
        )
    )
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-29T00:00:00Z") == 0
    b = json.loads((s.data_dir / "latest" / "builds.json").read_text())
    assert b["collected_at"] == "2026-09-28T00:00:00Z"  # yesterday's kept
    meta = json.loads((s.data_dir / "latest" / "meta.json").read_text())
    assert meta["collected_at"] == "2026-09-29T00:00:00Z"

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
        if fail_key == "sl_high" and q.get("league_tier") == "5,6":
            return httpx.Response(500, json={"error": {"code": "server_error", "message": "x"}})
        return httpx.Response(200, json=raw_by_map)

    respx.get(f"{BASE}/heroes/stats").mock(side_effect=stats)


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
        "meta.json",
        "qm.json.gz",
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
    # 60 s spacing between the five group_by_map calls → 4 waits
    assert fake_sleep.calls == [60.0] * 4


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
        ("sl", "1,2"),
        ("sl", "3,4"),
        ("sl", "5,6"),
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

"""Region rotation (#14, Basic plan): one region a day for QM + SL (2 extra Heroes/Stats calls),
KR → NA → EU by a deterministic day index; the other regions' files are carried forward."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from collector.run import run, run_backfill_previous
from collector.snapshot import REGIONS, region_for_day, region_specs
from tests.conftest import BASE
from tests.test_run import mock_api, settings


@pytest.mark.parametrize(
    ("day", "region"),
    [
        ("2026-09-30", "kr"),
        ("2026-10-01", "na"),
        ("2026-10-02", "eu"),
        ("2026-10-03", "kr"),
        ("2026-09-29", "eu"),  # before the epoch the cycle runs backwards the same way
        ("2027-01-01", REGIONS[(date(2027, 1, 1) - date(2026, 9, 30)).days % 3][0]),
    ],
)
def test_region_for_day_cycles_kr_na_eu(day: str, region: str) -> None:
    assert region_for_day(date.fromisoformat(day)) == region


def test_region_specs_are_qm_and_sl_without_brackets() -> None:
    specs = region_specs("na")
    assert [(s.key, s.game_type, s.league_tier, s.region, s.filename) for s in specs] == [
        ("qm_na", "qm", None, "NA", "qm_na.json"),
        ("sl_na", "sl", None, "NA", "sl_na.json"),
    ]


def _calls() -> list[dict[str, str]]:
    return [
        dict(httpx.QueryParams(c.request.url.query))
        for c in respx.calls
        if c.request.url.path.endswith("/heroes/stats")
    ]


def _latest(s: Any) -> dict[str, Any]:
    return {
        p.stem: json.loads(p.read_text())
        for p in (s.data_dir / "latest").iterdir()
        if p.suffix == ".json"
    }


@respx.mock
async def test_run_collects_todays_region_for_qm_and_sl(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-30T18:30:00Z") == 0
    regional = [(c["game_type"], c.get("league_tier")) for c in _calls() if "region" in c]
    assert regional == [("qm", None), ("sl", None)]
    assert {c["region"] for c in _calls() if "region" in c} == {"KR"}
    assert all(c["group_by_map"] == "true" for c in _calls())
    latest = _latest(s)
    assert latest["qm_kr"]["region"] == "KR" and latest["sl_kr"]["region"] == "KR"
    assert latest["qm"]["region"] is None
    assert latest["qm_kr"]["mode"] == "qm_kr" and latest["qm_kr"]["game_type"] == "qm"
    meta = latest["meta"]
    assert set(meta["modes"]) == {"qm", "sl", "sl_low", "sl_high", "qm_kr", "sl_kr"}
    assert meta["modes"]["qm_kr"]["collected_at"] == "2026-09-30T18:30:00Z"
    assert meta["modes"]["qm_kr"]["heroes_over_200"] >= 0
    # 4 stats + 2 solo + 2 region calls at 1/min (7 gaps) + 1 before builds
    assert fake_sleep.calls == [60.0] * 8


@respx.mock
async def test_next_day_adds_the_next_region_and_carries_the_others(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-30T18:30:00Z") == 0
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-10-01T18:30:00Z") == 0
    latest = _latest(s)
    assert latest["qm_kr"]["collected_at"] == "2026-09-30T18:30:00Z"  # carried
    assert latest["qm_na"]["collected_at"] == "2026-10-01T18:30:00Z"  # today's
    assert "qm_eu" not in latest
    modes = latest["meta"]["modes"]
    assert modes["sl_kr"]["collected_at"] == "2026-09-30T18:30:00Z"
    assert modes["sl_na"]["collected_at"] == "2026-10-01T18:30:00Z"
    # only today's region was asked for
    assert {c["region"] for c in _calls()[-2:]} == {"NA"}


@respx.mock
async def test_region_failure_keeps_yesterdays_region_files_and_the_run_succeeds(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    s = settings(tmp_path)
    # day 1 (KR) then 3 days later KR again, but the region call fails
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-30T18:30:00Z") == 0
    respx.reset()
    mock_api(raw_by_map, patches_payload)

    def stats(request: httpx.Request) -> httpx.Response:
        if "region" in dict(httpx.QueryParams(request.url.query)):
            return httpx.Response(429, json={"error": {"code": "quota_exceeded", "message": "w"}})
        return httpx.Response(200, json=raw_by_map)

    respx.get(f"{BASE}/heroes/stats").mock(side_effect=stats)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-10-03T18:30:00Z") == 0
    latest = _latest(s)
    assert latest["qm_kr"]["collected_at"] == "2026-09-30T18:30:00Z"
    assert latest["qm"]["collected_at"] == "2026-10-03T18:30:00Z"


@respx.mock
async def test_patch_change_moves_region_files_to_previous_and_drops_them_from_latest(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-30T18:30:00Z") == 0  # KR
    respx.reset()
    newer = json.loads(json.dumps(patches_payload))
    newer["patches"].append({"game_version": "2.55.18.99000", "valid_globals": True})
    respx.get(f"{BASE}/patches").mock(return_value=httpx.Response(200, json=newer))
    respx.get(f"{BASE}/heroes/stats").mock(return_value=httpx.Response(200, json=raw_by_map))
    respx.get(f"{BASE}/heroes/talents/builds/all").mock(
        return_value=httpx.Response(200, json={"Nova": []})
    )
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-10-01T18:30:00Z") == 0  # NA
    latest = _latest(s)
    assert "qm_kr" not in latest  # another patch: not carried
    assert latest["qm_na"]["patch"] == "2.55.18"
    assert "qm_kr" not in latest["meta"]["modes"]
    prev = json.loads((s.data_dir / "previous" / "qm_kr.json").read_text())
    assert prev["patch"] == "2.55.17"


@respx.mock
async def test_backfill_keeps_previous_region_files_of_the_same_patch_only(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-30T18:30:00Z") == 0
    prev = s.data_dir / "previous"
    prev.mkdir()
    (prev / "qm_kr.json").write_text(json.dumps({"patch": "2.55.9", "region": "KR"}))
    (prev / "sl_na.json").write_text(json.dumps({"patch": "2.55.16.00000", "region": "NA"}))
    respx.get(f"{BASE}/heroes/stats").mock(return_value=httpx.Response(200, json=raw_by_map))
    code = await run_backfill_previous(
        s, patch="2.55.9", sleep=fake_sleep, now=lambda: "2026-10-01T00:00:00Z"
    )
    assert code == 0
    names = sorted(p.name for p in prev.iterdir())
    assert names == ["qm.json", "qm_kr.json", "sl.json", "sl_high.json", "sl_low.json"]
    # backfill asks for the four global views only (regions rotate daily; 4 calls, as before)
    assert not [c for c in _calls()[-4:] if "region" in c]

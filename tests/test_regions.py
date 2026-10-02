"""The region × bracket cube (owner 2026-10-02, Intermediate plan): every view (QM, SL, 브실골플,
다마그) in every region (KR, NA, EU), each with its solo twin — 24 Heroes/Stats calls a day.
The whole is the sum of the regions; every view carries the party correction."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import respx

from collector.run import run, run_backfill_previous
from collector.snapshot import CELL_SPECS
from tests.conftest import BASE
from tests.test_run import CUR_TF, _mock_blizzard, settings

VIEWS = ("qm", "sl", "sl_low", "sl_high")
CELLS = [f"{m}_{r}" for r in ("kr", "na", "eu") for m in VIEWS]


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


def mock_cube(raw_by_map: dict[str, Any], patches: dict[str, Any], fail: str | None = None) -> None:
    """Every stats call answers raw_by_map; `fail` = "<region>" or "<region>/Solo" answers 500."""
    respx.get(f"{BASE}/patches").mock(return_value=httpx.Response(200, json=patches))

    def stats(request: httpx.Request) -> httpx.Response:
        q = dict(httpx.QueryParams(request.url.query))
        assert q["group_by_map"] == "true"
        tag = q.get("region", "") + ("/Solo" if q.get("groupsize") == "Solo" else "")
        if fail is not None and tag == fail:
            return httpx.Response(500, json={"error": {"code": "server_error", "message": "x"}})
        return httpx.Response(200, json=raw_by_map)

    respx.get(f"{BASE}/heroes/stats").mock(side_effect=stats)
    respx.get(f"{BASE}/heroes/talents/builds/all").mock(
        return_value=httpx.Response(200, json={"Nova": []})
    )
    _mock_blizzard()


@respx.mock
async def test_every_view_in_every_region_with_its_solo_twin(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_cube(raw_by_map, patches_payload)
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-10-03T00:00:00Z") == 0
    calls = _calls()
    assert len(calls) == 24
    assert all(c["timeframe"] == CUR_TF for c in calls)
    assert all(c.get("region") in {"KR", "NA", "EU"} for c in calls)  # the whole is summed
    tiers = {(c["region"], c["game_type"], c.get("league_tier"), c.get("groupsize")) for c in calls}
    assert ("KR", "sl", "1,2,3,4", "Solo") in tiers and ("EU", "qm", None, None) in tiers
    latest = _latest(s)
    assert set(VIEWS) | set(CELLS) <= set(latest)
    assert set(latest["meta"]["modes"]) == set(VIEWS) | set(CELLS)
    # the formula is the same everywhere: every view, every row
    for key in (*VIEWS, *CELLS):
        assert "party" in latest[key], key
        assert all("tier_win_rate" in r for r in latest[key]["rows"]), key


@respx.mock
async def test_the_whole_is_the_sum_of_its_regions(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_cube(raw_by_map, patches_payload)
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-10-03T00:00:00Z") == 0
    latest = _latest(s)
    for view in VIEWS:
        whole = latest[view]
        parts = [latest[f"{view}_{r}"] for r in ("kr", "na", "eu")]
        assert whole["region"] is None and all(p["region"] for p in parts)
        assert whole["matches"] == sum(p["matches"] for p in parts)
        rows = {(r["hero"], r["map"]): r for r in whole["rows"]}
        for p in parts[0]["rows"]:
            assert rows[(p["hero"], p["map"])]["wins"] == 3 * p["wins"]  # three equal regions
        # corrected with the summed solo games of the three regions
        assert whole["party"]["solo_games"] == sum(p["party"]["solo_games"] for p in parts)


@respx.mock
async def test_a_region_that_fails_keeps_yesterdays_files(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    """The whole is a sum: without one region it would be a different number under the same
    name, so nothing is updated (as with a missing party correction)."""
    mock_cube(raw_by_map, patches_payload)
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-10-03T00:00:00Z") == 0
    before = {p.name: p.read_bytes() for p in (s.data_dir / "latest").iterdir()}
    for fail in ("NA", "EU/Solo"):
        respx.reset()
        mock_cube(raw_by_map, patches_payload, fail=fail)
        assert await run(s, sleep=fake_sleep, now=lambda: "2026-10-04T00:00:00Z") != 0, fail
        assert {p.name: p.read_bytes() for p in (s.data_dir / "latest").iterdir()} == before


@respx.mock
async def test_patch_change_moves_every_view_to_previous(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_cube(raw_by_map, patches_payload)
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-10-03T00:00:00Z") == 0
    respx.reset()
    newer = json.loads(json.dumps(patches_payload))
    newer["patches"].append({"game_version": "2.55.18.99000", "valid_globals": True})
    respx.get(f"{BASE}/patches").mock(return_value=httpx.Response(200, json=newer))
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-10-04T00:00:00Z") == 0
    prev = {p.stem for p in (s.data_dir / "previous").glob("*.json")} - {"meta", "builds"}
    assert prev == set(VIEWS) | set(CELLS)
    meta = _latest(s)["meta"]
    assert set(meta["previous_modes"]) == set(VIEWS) | set(CELLS)


@respx.mock
async def test_backfill_collects_the_whole_cube_of_the_older_patch(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_cube(raw_by_map, patches_payload)
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-10-03T00:00:00Z") == 0
    respx.reset()
    code = await run_backfill_previous(
        s, patch="2.55.9", sleep=fake_sleep, now=lambda: "2026-10-03T01:00:00Z"
    )
    assert code == 0
    assert len(_calls()) == 24 and {c["timeframe"] for c in _calls()} == {"2.55.9.90000"}
    prev = {p.stem for p in (s.data_dir / "previous").glob("*.json")}
    assert prev == set(VIEWS) | set(CELLS)
    meta = _latest(s)["meta"]
    assert meta["previous_patch"] == "2.55.9" and set(meta["previous_modes"]) == prev


def test_cells_cover_three_regions_and_four_views() -> None:
    assert [s.key for s in CELL_SPECS] == CELLS

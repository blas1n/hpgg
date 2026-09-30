from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import httpx
import respx
from structlog.testing import capture_logs

from collector.config import Settings
from collector.run import run
from tests.conftest import BASE, TOKEN


def thin(raw_by_map: dict[str, Any]) -> dict[str, Any]:
    """The same payload with every hero far under the tier floor: a new patch's first day."""
    return {
        m: {**v, "data": [{**r, "wins": 1, "losses": 1, "games_played": 2} for r in v["data"]]}
        for m, v in raw_by_map.items()
    }


def settings(tmp_path: Path, **kw: Any) -> Settings:
    return Settings(
        _env_file=None,
        hp_api_token=TOKEN,
        hp_base_url=BASE,
        data_dir=tmp_path / "data",
        tmp_dir=tmp_path / "tmp",
        snapshot_out_dir=tmp_path / "snap",
        **{"patchnotes_limit": 3, **kw},  # the three notes in fixtures/patchnotes
    )


def mock_api(
    raw_by_map: dict[str, Any], patches: dict[str, Any], fail_key: str | None = None
) -> None:
    respx.get(f"{BASE}/patches").mock(return_value=httpx.Response(200, json=patches))

    def stats(request: httpx.Request) -> httpx.Response:
        q = dict(httpx.QueryParams(request.url.query))
        assert q["group_by_map"] == "true"
        # regions follow the reference patch (#14): the previous one while the new one is thin
        allowed = {"2.55.17.97771", "2.55.17.97650"} if q.get("region") else {"2.55.17.97771"}
        assert q["timeframe_type"] == "minor" and q["timeframe"] in allowed
        if fail_key == "sl_high" and q.get("league_tier") == "5,6":
            return httpx.Response(500, json={"error": {"code": "server_error", "message": "x"}})
        if fail_key == "solo" and q.get("groupsize") == "Solo":
            return httpx.Response(500, json={"error": {"code": "server_error", "message": "x"}})
        return httpx.Response(200, json=raw_by_map)

    respx.get(f"{BASE}/heroes/stats").mock(side_effect=stats)
    respx.get(f"{BASE}/heroes/talents/builds/all").mock(
        return_value=httpx.Response(200, json={"Nova": []})
    )
    _mock_blizzard()


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
        "qm_na.json",  # 2026-09-28 is an NA day in the region rotation
        "sl.json",
        "sl_high.json",
        "sl_low.json",
        "sl_na.json",
    ]
    meta = json.loads((latest / "meta.json").read_text())
    assert (
        meta["current_patch"] == "2.55.17.97771" and meta["collected_at"] == "2026-09-28T01:02:03Z"
    )
    assert set(meta["modes"]) == {"qm", "sl", "sl_low", "sl_high", "qm_na", "sl_na"}
    # raw responses kept gzipped for the snapshots branch
    day = s.snapshot_out_dir / "2026-09-28"
    assert sorted(p.name for p in day.iterdir()) == [
        "builds.json.gz",
        "meta.json",
        "qm.json.gz",
        "qm_na.json.gz",
        "raw_builds.json.gz",
        "raw_qm.json.gz",
        "raw_qm_na.json.gz",
        "raw_qm_solo.json.gz",
        "raw_sl.json.gz",
        "raw_sl_high.json.gz",
        "raw_sl_low.json.gz",
        "raw_sl_na.json.gz",
        "raw_sl_solo.json.gz",
        "sl.json.gz",
        "sl_high.json.gz",
        "sl_low.json.gz",
        "sl_na.json.gz",
    ]
    # 60 s spacing between the eight group_by_map calls → 7 waits, + 1 before builds/all
    assert fake_sleep.calls == [60.0] * 8


@respx.mock
async def test_run_passes_league_tier_and_game_type_per_spec(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    assert await run(settings(tmp_path), sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    calls = [
        dict(httpx.QueryParams(c.request.url.query))
        for c in respx.calls
        if c.request.url.path.endswith("/heroes/stats")
    ]
    assert [
        (c["game_type"], c.get("league_tier"), c.get("region"), c.get("groupsize")) for c in calls
    ] == [
        ("qm", None, None, None),
        ("sl", None, None, None),
        ("sl", "1,2,3,4", None, None),
        ("sl", "5,6", None, None),
        ("qm", None, None, "Solo"),
        ("sl", None, None, "Solo"),
        ("qm", None, "NA", None),
        ("sl", None, "NA", None),
    ]


@respx.mock
async def test_run_puts_the_party_correction_on_qm_and_sl_only(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    latest = s.data_dir / "latest"
    for key in ("qm", "sl"):
        snap = json.loads((latest / f"{key}.json").read_text())
        assert snap["party"]["k"] == 1000
        all_rows = [r for r in snap["rows"] if r["map"] == "all"]
        assert all_rows and all("tier_win_rate" in r for r in all_rows)
    for key in ("sl_low", "sl_high", "qm_na", "sl_na"):
        snap = json.loads((latest / f"{key}.json").read_text())
        assert "party" not in snap
        assert all("tier_win_rate" not in r for r in snap["rows"])


@respx.mock
async def test_solo_call_failure_leaves_the_views_uncorrected_and_the_run_succeeds(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload, fail_key="solo")
    s = settings(tmp_path)
    with capture_logs() as logs:
        assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    qm = json.loads((s.data_dir / "latest" / "qm.json").read_text())
    assert "party" not in qm and all("tier_win_rate" not in r for r in qm["rows"])
    assert any(e["event"] == "run.party_skipped" for e in logs)
    # the region calls still ran after the failed solo calls
    assert (s.data_dir / "latest" / "qm_na.json").exists()


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
    ]
    assert json.loads((prev / "qm.json").read_text())["patch"] == "2.55.17.97650"
    # previous ranks are compared with today's, so the backfill carries the same correction
    assert json.loads((prev / "qm.json").read_text())["party"]["k"] == 1000
    assert "party" not in json.loads((prev / "sl_low.json").read_text())
    day = s.snapshot_out_dir / "2026-09-28"
    assert (day / "backfill_2.55.17.97650_raw_qm_solo.json.gz").exists()
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
    assert fake_sleep.calls == [60.0] * 8  # 7 between 4 stats + 2 solo + 2 region, 1 before builds
    assert (s.snapshot_out_dir / "2026-09-28" / "raw_builds.json.gz").exists()


@respx.mock
async def test_builds_are_collected_for_the_reference_patch(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    """A new patch with a thin sample: builds follow the pages, on the previous patch."""
    mock_api(thin(raw_by_map), patches_payload)
    route = respx.get(f"{BASE}/heroes/talents/builds/all").mock(
        return_value=httpx.Response(200, json=_builds_payload())
    )
    s = settings(tmp_path)
    s.data_dir.joinpath("latest").mkdir(parents=True)
    healthy = {"matches": 9000, "heroes": 90, "heroes_over_200": 90}
    old = {
        "current_patch": "2.55.17.97650",
        "previous_patch": None,
        "modes": {"qm": healthy, "sl": healthy},
    }
    s.data_dir.joinpath("latest", "meta.json").write_text(json.dumps(old))
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    meta = json.loads((s.data_dir / "latest" / "meta.json").read_text())
    assert (meta["current_patch"], meta["reference_patch"]) == ("2.55.17.97771", "2.55.17.97650")
    q = dict(httpx.QueryParams(route.calls[0].request.url.query))
    assert q["timeframe"] == "2.55.17.97650"
    b = json.loads((s.data_dir / "latest" / "builds.json").read_text())
    assert b["patch"] == "2.55.17.97650"


@respx.mock
async def test_regions_are_collected_for_the_reference_patch_where_the_pages_read_it(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    """A thin new patch: the pages show the previous patch, so the region of the day is
    collected on it and lands in previous/ (latest/ holds the new patch's files)."""
    mock_api(thin(raw_by_map), patches_payload)
    s = settings(tmp_path)
    s.data_dir.joinpath("latest").mkdir(parents=True)
    healthy = {"matches": 9000, "heroes": 90, "heroes_over_200": 90}
    old = {
        "current_patch": "2.55.17.97650",
        "previous_patch": None,
        "modes": {"qm": healthy, "sl": healthy},
    }
    s.data_dir.joinpath("latest", "meta.json").write_text(json.dumps(old))
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    calls = [
        dict(httpx.QueryParams(c.request.url.query))
        for c in respx.calls
        if c.request.url.path.endswith("/heroes/stats") and "region" in str(c.request.url)
    ]
    assert [(c["game_type"], c["timeframe"]) for c in calls] == [
        ("qm", "2.55.17.97650"),
        ("sl", "2.55.17.97650"),
    ]
    prev = json.loads((s.data_dir / "previous" / "qm_na.json").read_text())
    assert (prev["patch"], prev["region"]) == ("2.55.17.97650", "NA")
    assert not (s.data_dir / "latest" / "qm_na.json").exists()
    assert (s.snapshot_out_dir / "2026-09-28" / "raw_qm_na.json.gz").exists()


@respx.mock
async def test_a_region_already_final_on_the_previous_patch_is_not_fetched_again(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    """A finished patch does not change: once today's region is in previous/, the day's two
    calls build the new patch's region, ready for when the new patch becomes the reference."""
    mock_api(thin(raw_by_map), patches_payload)
    s = settings(tmp_path)
    s.data_dir.joinpath("latest").mkdir(parents=True)
    healthy = {"matches": 9000, "heroes": 90, "heroes_over_200": 90}
    old = {
        "current_patch": "2.55.17.97650",
        "previous_patch": None,
        "modes": {"qm": healthy, "sl": healthy},
    }
    s.data_dir.joinpath("latest", "meta.json").write_text(json.dumps(old))
    # the first run fills previous/ (the region on the reference patch)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    kept = (s.data_dir / "previous" / "qm_na.json").read_text()
    first = len(respx.calls)
    # three days later NA comes round again: previous/ has it, so the new patch is collected
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-10-01T00:00:00Z") == 0
    calls = [
        dict(httpx.QueryParams(c.request.url.query))
        for c in list(respx.calls)[first:]
        if c.request.url.path.endswith("/heroes/stats") and "region" in str(c.request.url)
    ]
    assert [c["timeframe"] for c in calls] == ["2.55.17.97771", "2.55.17.97771"]
    assert (s.data_dir / "previous" / "qm_na.json").read_text() == kept
    latest = json.loads((s.data_dir / "latest" / "qm_na.json").read_text())
    assert latest["patch"] == "2.55.17.97771"


@respx.mock
async def test_matchups_are_collected_for_the_reference_patch(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(thin(raw_by_map), patches_payload)
    route = respx.get(f"{BASE}/heroes/matchups").mock(
        return_value=httpx.Response(200, json=_matchups_payload())
    )
    s = settings(tmp_path)
    _seed_heroes(s, ["Abathur"])
    healthy = {"matches": 9000, "heroes": 90, "heroes_over_200": 90}
    old = {
        "current_patch": "2.55.17.97650",
        "previous_patch": None,
        "modes": {"qm": healthy, "sl": healthy},
    }
    s.data_dir.joinpath("latest").mkdir(parents=True)
    s.data_dir.joinpath("latest", "meta.json").write_text(json.dumps(old))
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    q = dict(httpx.QueryParams(route.calls[0].request.url.query))
    assert q["timeframe"] == "2.55.17.97650"  # the reference patch, not the thin new one


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


@respx.mock
async def test_run_warns_about_heroes_in_the_stats_without_assets(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    # #6: a new hero reaches the stats before tools/build_assets.py can give it a Korean name and
    # portrait; the site hides it (web/src/lib/known.ts), so the run log is where we notice it.
    mock_api(raw_by_map, patches_payload)
    s = settings(tmp_path)
    s.data_dir.mkdir(parents=True)
    (s.data_dir / "heroes_ko.json").write_text(
        json.dumps({"roles": [], "heroes": [{"name": "Illidan"}, {"name": "Brightwing"}]})
    )
    with capture_logs() as logs:
        assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    warned = [e for e in logs if e["event"] == "run.heroes_without_assets"]
    assert warned == [
        {
            "event": "run.heroes_without_assets",
            "log_level": "warning",
            "heroes": ["Nova", "Probius"],  # Probius in the stats, Nova only in builds
            "fix": "rerun tools/build_assets.py with a heroes-data build that has them",
        }
    ]


@respx.mock
async def test_run_is_quiet_when_every_hero_has_assets_and_says_so_when_the_table_is_missing(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    s = settings(tmp_path)
    with capture_logs() as logs:
        assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    assert [e["event"] for e in logs if e["log_level"] == "warning"] == ["run.hero_table_missing"]
    names = [{"name": n} for n in ("Illidan", "Brightwing", "Probius", "Nova")]
    (s.data_dir / "heroes_ko.json").write_text(json.dumps({"roles": [], "heroes": names}))
    with capture_logs() as logs:
        assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-29T00:00:00Z") == 0
    assert [e for e in logs if e["log_level"] == "warning"] == []


def _seed_heroes(s: Settings, names: list[str]) -> None:
    s.data_dir.mkdir(parents=True, exist_ok=True)
    table = {"heroes": [{"name": n, "slug": n.lower()} for n in names]}
    (s.data_dir / "heroes_ko.json").write_text(json.dumps(table))


def _matchups_payload() -> dict[str, Any]:
    def row(name: str, wins: int, losses: int) -> dict[str, Any]:
        games = wins + losses
        return {"hero": {"name": name}, "wins": wins, "losses": losses, "games_played": games}

    return {"ally": [row("Nova", 60, 40)], "enemy": [row("Nova", 45, 55)], "combined": []}


@respx.mock
async def test_run_collects_matchups_for_every_due_hero_after_the_stats(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    route = respx.get(f"{BASE}/heroes/matchups").mock(
        return_value=httpx.Response(200, json=_matchups_payload())
    )
    s = settings(tmp_path)
    _seed_heroes(s, ["Illidan", "Brightwing"])
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    assert [dict(httpx.QueryParams(c.request.url.query))["hero"] for c in route.calls] == [
        "Illidan",
        "Brightwing",
    ]
    q = dict(httpx.QueryParams(route.calls[0].request.url.query))
    # thin fixture sample but no previous patch to fall back to → the current one
    assert (q["timeframe"], q["game_type"]) == ("2.55.17.97771", "sl")
    m = json.loads((s.data_dir / "matchups" / "illidan.json").read_text())
    assert (m["patch"], m["collected_at"]) == ("2.55.17.97771", "2026-09-28T00:00:00Z")
    assert (s.snapshot_out_dir / "2026-09-28" / "matchups.json.gz").exists()
    # 5 between 6 stats calls + 1 before builds, then one gap between the two matchups calls
    assert fake_sleep.calls == [60.0] * 8 + [s.matchups_call_spacing_seconds]
    # next day: nothing is due (every other day) → no calls, files untouched
    respx.reset()
    mock_api(raw_by_map, patches_payload)
    again = respx.get(f"{BASE}/heroes/matchups").mock(
        return_value=httpx.Response(200, json=_matchups_payload())
    )
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-29T00:00:00Z") == 0
    assert again.call_count == 0
    assert json.loads((s.data_dir / "matchups" / "illidan.json").read_text()) == m


@respx.mock
async def test_matchups_quota_exceeded_keeps_files_and_the_run_still_succeeds(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    respx.get(f"{BASE}/heroes/matchups").mock(
        return_value=httpx.Response(
            429, json={"error": {"code": "quota_exceeded", "message": "week"}}
        )
    )
    s = settings(tmp_path)
    _seed_heroes(s, ["Illidan"])
    (s.data_dir / "matchups").mkdir(parents=True)
    old = {"patch": "2.55.17.97771", "collected_at": "2026-09-20T00:00:00Z"}
    (s.data_dir / "matchups" / "illidan.json").write_text(json.dumps(old))
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    assert json.loads((s.data_dir / "matchups" / "illidan.json").read_text()) == old
    assert (s.data_dir / "latest" / "meta.json").exists()


@respx.mock
async def test_failed_stats_run_makes_no_matchups_calls(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload, fail_key="sl_high")
    route = respx.get(f"{BASE}/heroes/matchups").mock(
        return_value=httpx.Response(200, json=_matchups_payload())
    )
    s = settings(tmp_path)
    _seed_heroes(s, ["Illidan"])
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 1
    assert route.call_count == 0


# --- official patch notes (#62) ------------------------------------------------------------------

PN = Path(__file__).parent / "fixtures" / "patchnotes"


def _mock_blizzard(status: int = 200) -> list[httpx.Request]:
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if status != 200:
            return httpx.Response(status)
        parts = request.url.path.strip("/").split("/")  # ko-kr/api/news/… or ko-kr/article/<id>
        loc = parts[0]
        name = f"list_{loc}.json" if parts[1] == "api" else f"{parts[2]}_{loc}.html"
        return httpx.Response(200, text=(PN / name).read_text("utf-8"))

    respx.get(url__startswith="https://news.blizzard.com/").mock(side_effect=answer)
    return seen


@respx.mock
async def test_run_writes_the_patch_notes_without_sending_the_hp_token(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    seen = _mock_blizzard()  # replaces the route mock_api added, to record the requests
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    out = json.loads((s.data_dir / "patchnotes.json").read_text("utf-8"))
    assert [n["id"] for n in out["notes"]] == ["24303007", "24291432", "24276959"]
    assert seen and all("authorization" not in r.headers for r in seen)
    assert all(TOKEN not in str(r.url) for r in seen)


@respx.mock
async def test_blizzard_down_keeps_the_patch_notes_and_the_run_succeeds(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    mock_api(raw_by_map, patches_payload)
    _mock_blizzard(status=503)
    s = settings(tmp_path)
    s.data_dir.mkdir(parents=True)
    (s.data_dir / "patchnotes.json").write_text('{"notes": [{"id": "1"}]}', "utf-8")
    with capture_logs() as logs:
        assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    assert json.loads((s.data_dir / "patchnotes.json").read_text("utf-8")) == {
        "notes": [{"id": "1"}]
    }
    assert any(e["event"] == "run.patchnotes_failed" for e in logs)


@respx.mock
async def test_patch_notes_follow_blizzards_redirect_to_the_slugged_article(
    tmp_path: Path, raw_by_map, patches_payload, fake_sleep
) -> None:
    # measured 2026-09-30: /ko-kr/article/24303007/ → 302 → /ko-kr/article/24303007/2026-9-29
    mock_api(raw_by_map, patches_payload)

    def answer(request: httpx.Request) -> httpx.Response:
        parts = request.url.path.strip("/").split("/")
        loc = parts[0]
        if parts[1] == "api":
            return httpx.Response(200, text=(PN / f"list_{loc}.json").read_text("utf-8"))
        if len(parts) == 3:
            return httpx.Response(302, headers={"Location": f"{request.url.path}slug"})
        return httpx.Response(200, text=(PN / f"{parts[2]}_{loc}.html").read_text("utf-8"))

    respx.get(url__startswith="https://news.blizzard.com/").mock(side_effect=answer)
    s = settings(tmp_path)
    assert await run(s, sleep=fake_sleep, now=lambda: "2026-09-28T00:00:00Z") == 0
    assert len(json.loads((s.data_dir / "patchnotes.json").read_text("utf-8"))["notes"]) == 3

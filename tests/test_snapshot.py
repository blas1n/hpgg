from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from collector.models import HeroStat
from collector.snapshot import (
    MIN_GAMES_FOR_TIER,
    PATCH_HEALTH_GAMES,
    SPECS,
    build_meta,
    choose_patch,
    commit_atomic,
    load_meta,
    normalize_by_map,
    previous_modes,
    reference_patch,
    snapshot_to_json,
)
from tests.conftest import FIXTURES


def test_specs_are_the_four_daily_calls() -> None:
    keys = [s.key for s in SPECS]
    assert keys == ["qm", "sl", "sl_low", "sl_high"]
    by = {s.key: s for s in SPECS}
    assert by["qm"].game_type == "qm" and by["qm"].league_tier is None
    assert by["sl"].game_type == "sl" and by["sl"].league_tier is None
    # two brackets while the player base is small: 브실골플 / 다마그 (HP has no grandmaster id;
    # grandmasters are inside master, 6)
    assert by["sl_low"].league_tier == (1, 2, 3, 4)
    assert by["sl_high"].league_tier == (5, 6)
    assert {s.filename for s in SPECS} == {
        "qm.json",
        "sl.json",
        "sl_low.json",
        "sl_high.json",
    }


def test_choose_patch_picks_latest_valid_globals_by_version(patches_payload) -> None:
    # 98025 is newer but valid_globals=false → skip; 97771 is the newest valid one
    assert choose_patch(patches_payload) == "2.55.17.97771"


def test_choose_patch_raises_when_nothing_valid() -> None:
    with pytest.raises(ValueError):
        choose_patch({"patches": [{"game_version": "2.55.1.1", "valid_globals": False}]})


def test_normalize_keeps_per_map_rows_and_derives_all(raw_by_map) -> None:
    snap = normalize_by_map(
        raw_by_map,
        key="sl",
        game_type="sl",
        league_tier=None,
        patch="2.55.17.97771",
        collected_at="2026-09-28T00:00:00Z",
    )
    rows = {(r.map, r.hero): r for r in snap.rows}
    # per-map rows pass through
    ch = rows[("Cursed Hollow", "Illidan")]
    assert (ch.wins, ch.losses, ch.games, ch.bans) == (60, 40, 100, 10)
    assert ch.win_rate == 60.0 and ch.pick == 100.0 and ch.ci == 1.5
    # derived "all": sums
    ill = rows[("all", "Illidan")]
    assert (ill.wins, ill.losses, ill.games, ill.bans) == (160, 140, 300, 30)
    assert ill.win_rate == pytest.approx(160 / 300 * 100, abs=0.01)
    # matches = Σgames/10 over all heroes & maps: (100+100+5)+(200+200) = 605 → 60.5 → 60 (int)
    assert snap.matches == 60
    assert ill.pick == pytest.approx(300 / 60.5 * 100, abs=0.5)
    assert ill.ban_rate == pytest.approx(30 / 60.5 * 100, abs=0.5)
    assert ill.popularity == pytest.approx((300 + 30) / 60.5 * 100, abs=0.5)
    assert ill.ci is None  # not derivable from the API; frontend uses Wilson
    assert snap.patch == "2.55.17.97771" and snap.key == "sl"


def test_normalize_accepts_list_shaped_maps_and_missing_optional_fields() -> None:
    raw = {"Sky Temple": [{"name": "Nova", "wins": 1, "losses": 3}]}
    snap = normalize_by_map(
        raw, key="qm", game_type="qm", league_tier=None, patch="p", collected_at="t"
    )
    r = {(x.map, x.hero): x for x in snap.rows}[("Sky Temple", "Nova")]
    assert (r.games, r.bans, r.win_rate) == (4, 0, 25.0)
    assert r.ci is None


def test_normalize_flat_payload_becomes_all_rows_only() -> None:
    raw = {
        "average_win_rate": 50,
        "data": [{"name": "Qhira", "wins": 100}, {"name": "Nova", "wins": 20, "losses": 30}],
    }
    snap = normalize_by_map(
        raw, key="qm", game_type="qm", league_tier=None, patch="p", collected_at="t"
    )
    assert {r.map for r in snap.rows} == {"all"}
    assert {r.hero: r.games for r in snap.rows} == {"Qhira": 100, "Nova": 50}
    assert snap.matches == 15


def test_normalize_derives_ban_count_from_ban_rate_when_live_rows_lack_bans() -> None:
    # live v1 shape (probe 2026-09-28): ban_rate % present, no `bans` count
    raw = {
        "Cursed Hollow": {
            "average_win_rate": 50,
            "data": [
                {
                    "name": "Qhira",
                    "wins": 600,
                    "losses": 400,
                    "games_played": 1000,
                    "ban_rate": 40.0,
                    "pick_rate": 50.0,
                },
                {
                    "name": "Nova",
                    "wins": 500,
                    "losses": 500,
                    "games_played": 1000,
                    "ban_rate": 0,
                    "pick_rate": 50.0,
                },
            ],
        }
    }
    snap = normalize_by_map(
        raw, key="sl", game_type="sl", league_tier=None, patch="p", collected_at="t"
    )
    rows = {(r.map, r.hero): r for r in snap.rows}
    # map matches = 2000/10 = 200 → Qhira bans = 40% × 200 = 80
    assert rows[("Cursed Hollow", "Qhira")].bans == 80
    assert rows[("all", "Qhira")].bans == 80 and rows[("all", "Qhira")].ban_rate == pytest.approx(
        40.0
    )
    assert rows[("all", "Nova")].bans == 0


def test_live_probe_fixture_normalizes_per_map() -> None:
    import gzip

    path = FIXTURES / "live_probe_qm_2.55.17.98025.json.gz"
    with gzip.open(path, "rt", encoding="utf-8") as f:
        raw = json.load(f)
    snap = normalize_by_map(
        raw, key="qm", game_type="qm", league_tier=None, patch="2.55.17.98025", collected_at="t"
    )
    maps = {r.map for r in snap.rows}
    assert "all" in maps and "Cursed Hollow" in maps and len(maps) > 10
    qhira = {(r.map, r.hero): r for r in snap.rows}[("all", "Qhira")]
    assert qhira.games > 1000 and 50 < qhira.win_rate < 65 and qhira.ci is None
    per_map_qhira = next(r for r in snap.rows if r.hero == "Qhira" and r.map == "Alterac Pass")
    assert per_map_qhira.ci == 3.63 and per_map_qhira.games == 706


def test_normalize_rejects_empty_payload() -> None:
    with pytest.raises(ValueError):
        normalize_by_map(
            {}, key="qm", game_type="qm", league_tier=None, patch="p", collected_at="t"
        )


def test_snapshot_to_json_matches_frontend_contract(raw_by_map) -> None:
    snap = normalize_by_map(
        raw_by_map, key="qm", game_type="qm", league_tier=None, patch="p1", collected_at="t1"
    )
    d = snapshot_to_json(snap)
    assert set(d) == {
        "patch",
        "mode",
        "game_type",
        "league_tier",
        "region",
        "collected_at",
        "matches",
        "rows",
    }
    assert d["mode"] == "qm" and d["league_tier"] is None
    row = next(r for r in d["rows"] if r["map"] == "all" and r["hero"] == "Illidan")
    assert set(row) == {
        "hero",
        "map",
        "wins",
        "losses",
        "games",
        "bans",
        "pick",
        "popularity",
        "win_rate",
        "ban_rate",
        "ci",
    }


def _snap(key: str, patch: str) -> dict:
    return {
        "patch": patch,
        "mode": key,
        "game_type": key,
        "league_tier": None,
        "collected_at": "t",
        "matches": 1,
        "rows": [
            {
                "hero": "Nova",
                "map": "all",
                "wins": 1,
                "losses": 1,
                "games": 2,
                "bans": 0,
                "pick": 1.0,
                "popularity": 1.0,
                "win_rate": 50.0,
                "ban_rate": 0.0,
                "ci": None,
            }
        ],
    }


def _healthy(patch: str) -> dict[str, dict]:
    """QM and SL snapshots with every hero over the tier floor: a build with a real sample."""
    out = {}
    for key in ("qm", "sl"):
        snap = _snap(key, patch)
        snap["rows"] = [{**r, "wins": 200, "losses": 200, "games": 400} for r in snap["rows"]]
        out[key] = snap
    return out


def _thin(patch: str) -> dict[str, dict]:
    return {key: _snap(key, patch) for key in ("qm", "sl")}


def test_build_meta_first_run_and_patch_change() -> None:
    m1 = build_meta(None, patch="p1", collected_at="2026-09-28T01:00:00Z", snapshots=_healthy("p1"))
    assert m1["current_patch"] == "p1" and m1["previous_patch"] is None
    assert m1["patch_started_at"] == "2026-09-28"
    assert m1["modes"]["qm"]["heroes_over_200"] == 1 and m1["modes"]["qm"]["heroes"] == 1
    m2 = build_meta(m1, patch="p1", collected_at="2026-09-29T01:00:00Z", snapshots=_healthy("p1"))
    assert m2["patch_started_at"] == "2026-09-28"  # unchanged while patch is the same
    m3 = build_meta(m2, patch="p2", collected_at="2026-10-01T01:00:00Z", snapshots=_thin("p2"))
    assert (m3["current_patch"], m3["previous_patch"], m3["patch_started_at"]) == (
        "p2",
        "p1",
        "2026-10-01",
    )


def test_the_tier_floor_and_the_patch_health_floor_are_counted_apart() -> None:
    """Owner 2026-10-01: tiers from 50 games (a hero never tiered says nothing); whether a
    patch has a real sample stays at 200 (reference patch, promotion)."""
    assert (MIN_GAMES_FOR_TIER, PATCH_HEALTH_GAMES) == (50, 200)
    snaps = _healthy("p1")
    for snap in snaps.values():
        snap["rows"] = [{**r, "wins": 60, "losses": 60, "games": 120} for r in snap["rows"]]
    m = build_meta(None, patch="p1", collected_at="2026-10-01T01:00:00Z", snapshots=snaps)
    assert m["min_games_for_tier"] == 50
    assert (m["modes"]["qm"]["heroes_ranked"], m["modes"]["qm"]["heroes_over_200"]) == (1, 0)
    m2 = build_meta(m, patch="p2", collected_at="2026-10-02T01:00:00Z", snapshots=_healthy("p2"))
    assert m2["previous_patch"] is None  # 120 games each: tiered, but not a patch to fall back to


def test_commit_atomic_writes_latest_and_moves_previous_on_patch_change(tmp_path: Path) -> None:
    data, tmp = tmp_path / "data", tmp_path / "tmp"
    meta1 = build_meta(
        None, patch="p1", collected_at="2026-09-28T00:00:00Z", snapshots=_healthy("p1")
    )
    commit_atomic(data_dir=data, tmp_dir=tmp, snapshots=_healthy("p1"), meta=meta1, prev_meta=None)
    assert json.loads((data / "latest" / "qm.json").read_text())["patch"] == "p1"
    assert load_meta(data) == meta1
    assert not (data / "previous").exists()
    assert not tmp.exists() or not any(tmp.iterdir())
    # patch change: latest → previous, new latest written, in one commit
    meta2 = build_meta(
        meta1, patch="p2", collected_at="2026-10-01T00:00:00Z", snapshots=_thin("p2")
    )
    commit_atomic(data_dir=data, tmp_dir=tmp, snapshots=_thin("p2"), meta=meta2, prev_meta=meta1)
    assert json.loads((data / "latest" / "qm.json").read_text())["patch"] == "p2"
    assert json.loads((data / "previous" / "qm.json").read_text())["patch"] == "p1"
    assert load_meta(data)["previous_patch"] == "p1"


def test_commit_atomic_is_all_or_nothing(tmp_path: Path, monkeypatch) -> None:
    data, tmp = tmp_path / "data", tmp_path / "tmp"
    meta1 = build_meta(None, patch="p1", collected_at="t", snapshots={"qm": _snap("qm", "p1")})
    commit_atomic(
        data_dir=data, tmp_dir=tmp, snapshots={"qm": _snap("qm", "p1")}, meta=meta1, prev_meta=None
    )
    # make the swap fail midway: json.dumps raises for a non-serialisable row
    bad = {"qm": _snap("qm", "p2")}
    bad["qm"]["rows"][0]["hero"] = object()  # type: ignore[assignment]
    with pytest.raises(TypeError):
        commit_atomic(
            data_dir=data,
            tmp_dir=tmp,
            snapshots=bad,
            meta=meta1 | {"current_patch": "p2"},
            prev_meta=meta1,
        )
    assert json.loads((data / "latest" / "qm.json").read_text())["patch"] == "p1"
    assert load_meta(data)["current_patch"] == "p1"


def test_herostat_is_frozen() -> None:
    r = HeroStat("Nova", "all", 1, 1, 2, 0, 1.0, 1.0, 50.0, 0.0)
    with pytest.raises(dataclasses.FrozenInstanceError):
        r.wins = 5  # type: ignore[misc]


def _modes(qm_over: int, sl_over: int, heroes: int = 90) -> dict:
    return {
        "qm": {"matches": 1, "heroes": heroes, "heroes_over_200": qm_over},
        "sl": {"matches": 1, "heroes": heroes, "heroes_over_200": sl_over},
        # brackets and regions never decide it
        "sl_high": {"matches": 1, "heroes": heroes, "heroes_over_200": 0},
        "qm_kr": {"matches": 1, "heroes": heroes, "heroes_over_200": 0},
    }


def test_reference_patch_is_one_patch_for_the_whole_site() -> None:
    """Owner 2026-09-29: one reference patch, used everywhere (stats, builds, matchups, draft)."""
    assert reference_patch("new", "old", _modes(80, 80)) == "new"
    assert reference_patch("new", "old", _modes(80, 44)) == "old"  # SL thin: all on old
    assert reference_patch("new", "old", _modes(44, 80)) == "old"
    assert reference_patch("new", "old", _modes(45, 45)) == "new"  # half the heroes over the floor
    assert reference_patch("new", None, _modes(0, 0)) == "new"  # nothing to fall back to
    assert reference_patch("new", "old", {}) == "new"  # no sample recorded: nothing says thin


def test_build_meta_records_the_reference_patch() -> None:
    m1 = build_meta(None, patch="p1", collected_at="2026-09-28T01:00:00Z", snapshots=_healthy("p1"))
    assert m1["reference_patch"] == "p1"
    m2 = build_meta(m1, patch="p2", collected_at="2026-10-01T01:00:00Z", snapshots=_thin("p2"))
    assert m2["reference_patch"] == "p1"  # the new patch's one-game sample is thin


def test_a_thin_build_is_never_promoted_to_previous(tmp_path: Path) -> None:
    """2026-09-30: hotfix 2.57.0.98304 a day after 2.57.0.98285 (419 matches). The previous
    patch stays the last build with a real sample (2.55.17.98025); the thin one is dropped."""
    data, tmp = tmp_path / "data", tmp_path / "tmp"
    m1 = build_meta(None, patch="p1", collected_at="2026-09-12T00:00:00Z", snapshots=_healthy("p1"))
    commit_atomic(data_dir=data, tmp_dir=tmp, snapshots=_healthy("p1"), meta=m1, prev_meta=None)
    m2 = build_meta(m1, patch="p2", collected_at="2026-09-28T00:00:00Z", snapshots=_thin("p2"))
    commit_atomic(data_dir=data, tmp_dir=tmp, snapshots=_thin("p2"), meta=m2, prev_meta=m1)
    assert (m2["previous_patch"], m2["reference_patch"]) == ("p1", "p1")
    # the hotfix: p2 was thin, so it does not take p1's place
    m3 = build_meta(m2, patch="p3", collected_at="2026-09-29T00:00:00Z", snapshots=_thin("p3"))
    commit_atomic(data_dir=data, tmp_dir=tmp, snapshots=_thin("p3"), meta=m3, prev_meta=m2)
    assert (m3["current_patch"], m3["previous_patch"], m3["reference_patch"]) == ("p3", "p1", "p1")
    assert json.loads((data / "previous" / "qm.json").read_text())["patch"] == "p1"
    assert json.loads((data / "latest" / "qm.json").read_text())["patch"] == "p3"
    assert m3["patch_started_at"] == "2026-09-29"
    # once p3 is healthy and p4 arrives, p3 is the previous patch
    m4 = build_meta(m3, patch="p3", collected_at="2026-10-05T00:00:00Z", snapshots=_healthy("p3"))
    commit_atomic(data_dir=data, tmp_dir=tmp, snapshots=_healthy("p3"), meta=m4, prev_meta=m3)
    m5 = build_meta(m4, patch="p4", collected_at="2026-10-20T00:00:00Z", snapshots=_thin("p4"))
    commit_atomic(data_dir=data, tmp_dir=tmp, snapshots=_thin("p4"), meta=m5, prev_meta=m4)
    assert (m5["previous_patch"], m5["reference_patch"]) == ("p3", "p3")
    assert json.loads((data / "previous" / "qm.json").read_text())["patch"] == "p3"


def test_choose_patch_skips_a_build_added_within_the_last_hour() -> None:
    """HP lists a new build before its stats accept it (two 10-minute caches): 422 on 2026-09-30."""
    payload = {
        "patches": [
            {
                "game_version": "2.57.0.98285",
                "valid_globals": True,
                "date_added": "2026-09-28T21:27:21.000000Z",
            },
            {
                "game_version": "2.57.0.98304",
                "valid_globals": True,
                "date_added": "2026-09-29T22:08:51.000000Z",
            },
        ]
    }
    from datetime import UTC, datetime

    at = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))  # noqa: E731
    assert choose_patch(payload, now=at("2026-09-29T22:15:51Z")) == "2.57.0.98285"
    assert choose_patch(payload, now=at("2026-09-29T23:08:51Z")) == "2.57.0.98304"
    assert choose_patch(payload) == "2.57.0.98304"  # no clock: every listed build
    assert UTC is not None


def test_previous_modes_describe_the_previous_patch_files_only(tmp_path: Path) -> None:
    """The pages decide which views exist on the previous patch from meta (#14: a region
    backfilled into previous/ is invisible to the tier page otherwise)."""
    prev = tmp_path / "previous"
    prev.mkdir()
    row = {"hero": "Nova", "map": "all", "games": 300}
    snap = {"patch": "old", "collected_at": "c", "matches": 7, "rows": [row, {**row, "map": "x"}]}
    (prev / "qm_kr.json").write_text(json.dumps(snap))
    (prev / "qm_na.json").write_text(json.dumps({**snap, "patch": "older"}))  # another build
    (prev / "meta.json").write_text(json.dumps({"current_patch": "old"}))  # copied with latest/
    (prev / "builds.json").write_text(json.dumps({"patch": "old", "heroes": {}}))
    assert previous_modes(tmp_path, "old") == {
        "qm_kr": {
            "matches": 7,
            "heroes": 1,
            "heroes_ranked": 1,
            "heroes_over_200": 1,
            "collected_at": "c",
        }
    }
    assert previous_modes(tmp_path, None) == {}
    assert previous_modes(tmp_path / "nowhere", "old") == {}

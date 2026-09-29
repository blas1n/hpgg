from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from collector.models import HeroStat
from collector.snapshot import (
    SPECS,
    build_meta,
    choose_patch,
    commit_atomic,
    load_meta,
    normalize_by_map,
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


def test_build_meta_first_run_and_patch_change() -> None:
    m1 = build_meta(
        None, patch="p1", collected_at="2026-09-28T01:00:00Z", snapshots={"qm": _snap("qm", "p1")}
    )
    assert m1["current_patch"] == "p1" and m1["previous_patch"] is None
    assert m1["patch_started_at"] == "2026-09-28"
    assert m1["modes"]["qm"]["heroes_over_200"] == 0 and m1["modes"]["qm"]["heroes"] == 1
    m2 = build_meta(
        m1, patch="p1", collected_at="2026-09-29T01:00:00Z", snapshots={"qm": _snap("qm", "p1")}
    )
    assert m2["patch_started_at"] == "2026-09-28"  # unchanged while patch is the same
    m3 = build_meta(
        m2, patch="p2", collected_at="2026-10-01T01:00:00Z", snapshots={"qm": _snap("qm", "p2")}
    )
    assert (m3["current_patch"], m3["previous_patch"], m3["patch_started_at"]) == (
        "p2",
        "p1",
        "2026-10-01",
    )


def test_commit_atomic_writes_latest_and_moves_previous_on_patch_change(tmp_path: Path) -> None:
    data, tmp = tmp_path / "data", tmp_path / "tmp"
    meta1 = build_meta(
        None, patch="p1", collected_at="2026-09-28T00:00:00Z", snapshots={"qm": _snap("qm", "p1")}
    )
    commit_atomic(
        data_dir=data, tmp_dir=tmp, snapshots={"qm": _snap("qm", "p1")}, meta=meta1, prev_meta=None
    )
    assert json.loads((data / "latest" / "qm.json").read_text())["patch"] == "p1"
    assert load_meta(data) == meta1
    assert not (data / "previous").exists()
    assert not tmp.exists() or not any(tmp.iterdir())
    # patch change: latest → previous, new latest written, in one commit
    meta2 = build_meta(
        meta1, patch="p2", collected_at="2026-10-01T00:00:00Z", snapshots={"qm": _snap("qm", "p2")}
    )
    commit_atomic(
        data_dir=data, tmp_dir=tmp, snapshots={"qm": _snap("qm", "p2")}, meta=meta2, prev_meta=meta1
    )
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
    m1 = build_meta(
        None, patch="p1", collected_at="2026-09-28T01:00:00Z", snapshots={"qm": _snap("qm", "p1")}
    )
    assert m1["reference_patch"] == "p1"
    m2 = build_meta(
        m1, patch="p2", collected_at="2026-10-01T01:00:00Z", snapshots={"qm": _snap("qm", "p2")}
    )
    assert m2["reference_patch"] == "p1"  # the new patch's one-game sample is thin

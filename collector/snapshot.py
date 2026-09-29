"""Job specs, response normalisation, meta bookkeeping and the atomic commit of data/latest."""

from __future__ import annotations

import json
import shutil
from dataclasses import asdict
from datetime import date
from pathlib import Path
from typing import Any

import structlog

from collector.models import HeroStat, JobSpec, ModeSnapshot

log = structlog.get_logger(__name__)

# The four daily calls. league_tier ids: 1 bronze … 6 master; HP has no grandmaster id, so
# grandmasters are counted inside master. Two brackets while the player base is small
# (브실골플 / 다마그, owner 2026-09-29); split further when samples allow.
SPECS: tuple[JobSpec, ...] = (
    JobSpec("qm", "qm", None, "qm.json"),
    JobSpec("sl", "sl", None, "sl.json"),
    JobSpec("sl_low", "sl", (1, 2, 3, 4), "sl_low.json"),
    JobSpec("sl_high", "sl", (5, 6), "sl_high.json"),
)

# Party correction (#36): the same QM and SL views, solo-queue games only. Folded into qm.json /
# sl.json by collector.party (2 more Heroes/Stats calls → 56/70 a week); never written as files.
SOLO_SPECS: tuple[JobSpec, ...] = (
    JobSpec("qm_solo", "qm", None, "", groupsize="Solo"),
    JobSpec("sl_solo", "sl", None, "", groupsize="Solo"),
)
SOLO_OF: dict[str, str] = {"qm_solo": "qm", "sl_solo": "sl"}

MIN_GAMES_FOR_TIER = 200

# Regions (#14, owner 2026-09-29, Basic plan): one region a day for QM + SL (2 extra Heroes/Stats
# calls → 14/week; 42/70 in total), KR → NA → EU by the day index below; each region is 3 days old
# at most. Region × bracket is not collected. The in-game Asia server is `KR`; CN is left out.
REGIONS: tuple[tuple[str, str], ...] = (("kr", "KR"), ("na", "NA"), ("eu", "EU"))
REGION_EPOCH = date(2026, 9, 30)  # a KR day
REGION_KEYS: tuple[str, ...] = tuple(f"{m}_{r}" for r, _ in REGIONS for m in ("qm", "sl"))


def region_for_day(day: date) -> str:
    """The region collected on this (UTC) day: KR, NA, EU, KR, … counted from REGION_EPOCH."""
    return REGIONS[(day - REGION_EPOCH).days % len(REGIONS)][0]


def region_specs(region: str) -> tuple[JobSpec, ...]:
    code = dict(REGIONS)[region]
    return tuple(
        JobSpec(f"{m}_{region}", m, None, f"{m}_{region}.json", region=code) for m in ("qm", "sl")
    )


def _version_key(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in v.split("."))


def choose_patch(patches_payload: dict[str, Any]) -> str:
    """Newest build (by version tuple) whose globals are queryable."""
    candidates = [
        p["game_version"]
        for p in patches_payload.get("patches", [])
        if p.get("valid_globals") and isinstance(p.get("game_version"), str)
    ]
    if not candidates:
        raise ValueError("no patch with valid_globals=true in /patches")
    return str(max(candidates, key=_version_key))


def _rows_of(map_payload: Any) -> list[dict[str, Any]]:
    if isinstance(map_payload, list):
        return [r for r in map_payload if isinstance(r, dict)]
    if isinstance(map_payload, dict):
        data = map_payload.get("data")
        if isinstance(data, list):
            return [r for r in data if isinstance(r, dict)]
    return []


def _num(row: dict[str, Any], key: str, default: float = 0.0) -> float:
    v = row.get(key)
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _row_to_stat(row: dict[str, Any], map_name: str) -> HeroStat | None:
    hero = row.get("name") or row.get("hero")
    if not isinstance(hero, str) or not hero:
        return None
    wins = int(_num(row, "wins"))
    losses = int(_num(row, "losses"))
    games = int(_num(row, "games_played", wins + losses)) or (wins + losses)
    bans = int(_num(row, "bans"))
    win_rate = _num(row, "win_rate", (wins / games * 100) if games else 0.0)
    ci_raw = row.get("confidence_interval")
    ci = float(ci_raw) if isinstance(ci_raw, int | float) else None
    return HeroStat(
        hero=hero,
        map=map_name,
        wins=wins,
        losses=losses,
        games=games,
        bans=bans,
        pick=_num(row, "pick_rate"),
        popularity=_num(row, "popularity"),
        win_rate=round(win_rate, 4),
        ban_rate=_num(row, "ban_rate"),
        ci=ci,
    )


def derive_all(per_map: list[HeroStat], matches: float) -> list[HeroStat]:
    """Sum the per-map rows into one `map="all"` row per hero. pick/ban/popularity are
    recomputed against the derived match count (Σgames / 10 for a 10-player game)."""
    acc: dict[str, dict[str, int]] = {}
    for r in per_map:
        a = acc.setdefault(r.hero, {"wins": 0, "losses": 0, "games": 0, "bans": 0})
        a["wins"] += r.wins
        a["losses"] += r.losses
        a["games"] += r.games
        a["bans"] += r.bans
    out: list[HeroStat] = []
    for hero, a in acc.items():
        games = a["games"]
        out.append(
            HeroStat(
                hero=hero,
                map="all",
                wins=a["wins"],
                losses=a["losses"],
                games=games,
                bans=a["bans"],
                pick=round(games / matches * 100, 4) if matches else 0.0,
                popularity=round((games + a["bans"]) / matches * 100, 4) if matches else 0.0,
                win_rate=round(a["wins"] / games * 100, 4) if games else 0.0,
                ban_rate=round(a["bans"] / matches * 100, 4) if matches else 0.0,
                ci=None,
            )
        )
    return out


def normalize_by_map(
    raw: Any,
    *,
    key: str,
    game_type: str,
    league_tier: tuple[int, ...] | None,
    patch: str,
    collected_at: str,
) -> ModeSnapshot:
    """Accepts `{map: {..., data: [rows]}}`, `{map: [rows]}` or `{data: {map: ...}}`.

    A flat payload (`{..., data: [rows]}`, not keyed by map) is what the server sends when
    it ignored group_by_map or in test-data mode; it becomes the "all" view only.
    """
    if isinstance(raw, dict) and isinstance(raw.get("data"), list):
        flat = [s for r in raw["data"] if isinstance(r, dict) and (s := _row_to_stat(r, "all"))]
        if not flat:
            raise ValueError("flat payload had no hero rows")
        log.warning("normalize.flat_payload", key=key, rows=len(flat))
        return ModeSnapshot(
            patch=patch,
            key=key,
            game_type=game_type,
            league_tier=league_tier,
            collected_at=collected_at,
            matches=int(sum(r.games for r in flat) / 10),
            rows=flat,
        )
    payload = (
        raw.get("data") if isinstance(raw, dict) and isinstance(raw.get("data"), dict) else raw
    )
    if not isinstance(payload, dict) or not payload:
        raise ValueError("empty or non-object group_by_map payload")
    per_map: list[HeroStat] = []
    for map_name, map_payload in payload.items():
        if not isinstance(map_name, str) or map_name.startswith("average_"):
            continue
        map_rows = _rows_of(map_payload)
        # Live v1 rows carry ban_rate (%) but no ban count: derive it from the map's match
        # count (Σgames / 10) so the "all" aggregation can sum bans across maps.
        map_matches = (
            sum(_num(r, "games_played", _num(r, "wins") + _num(r, "losses")) for r in map_rows) / 10
        )
        for row in map_rows:
            if "bans" not in row and "ban_rate" in row and map_matches:
                row = {**row, "bans": round(_num(row, "ban_rate") / 100 * map_matches)}
            stat = _row_to_stat(row, map_name)
            if stat is not None:
                per_map.append(stat)
    if not per_map:
        raise ValueError("group_by_map payload had no hero rows")
    total_games = sum(r.games for r in per_map)
    matches_f = total_games / 10
    rows = derive_all(per_map, matches_f) + per_map
    return ModeSnapshot(
        patch=patch,
        key=key,
        game_type=game_type,
        league_tier=league_tier,
        collected_at=collected_at,
        matches=int(matches_f),
        rows=rows,
    )


def snapshot_to_json(snap: ModeSnapshot) -> dict[str, Any]:
    """The frontend contract: latest/{mode}.json."""
    return {
        "patch": snap.patch,
        "mode": snap.key,
        "game_type": snap.game_type,
        "league_tier": list(snap.league_tier) if snap.league_tier else None,
        "region": snap.region,
        "collected_at": snap.collected_at,
        "matches": snap.matches,
        "rows": [asdict(r) for r in snap.rows],
    }


def load_meta(data_dir: Path) -> dict[str, Any] | None:
    p = data_dir / "latest" / "meta.json"
    if not p.exists():
        return None
    loaded = json.loads(p.read_text(encoding="utf-8"))
    return loaded if isinstance(loaded, dict) else None


def heroes_without_assets(
    data_dir: Path, snapshots: dict[str, dict[str, Any]], builds: dict[str, Any] | None
) -> list[str] | None:
    """Heroes in the stats or builds that `heroes_ko.json` lacks — the site does not show them
    (web/src/lib/known.ts). None when the hero table itself is missing."""
    p = data_dir / "heroes_ko.json"
    if not p.exists():
        return None
    known = {h["name"] for h in json.loads(p.read_text(encoding="utf-8"))["heroes"]}
    seen = {r["hero"] for snap in snapshots.values() for r in snap["rows"]}
    seen |= set((builds or {}).get("heroes", {}))
    return sorted(seen - known)


def build_meta(
    prev_meta: dict[str, Any] | None,
    *,
    patch: str,
    collected_at: str,
    snapshots: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """meta.json: patch ids, when the current patch was first seen, per-mode sample health."""
    today = collected_at[:10]
    if prev_meta and prev_meta.get("current_patch") == patch:
        previous_patch = prev_meta.get("previous_patch")
        patch_started_at = prev_meta.get("patch_started_at", today)
    elif prev_meta:
        previous_patch = prev_meta.get("current_patch")
        patch_started_at = today
    else:
        previous_patch = None
        patch_started_at = today
    modes: dict[str, Any] = {}
    for key, snap in snapshots.items():
        all_rows = [r for r in snap["rows"] if r["map"] == "all"]
        modes[key] = {
            "matches": snap["matches"],
            "heroes": len(all_rows),
            "heroes_over_200": sum(1 for r in all_rows if r["games"] >= MIN_GAMES_FOR_TIER),
            "collected_at": snap.get("collected_at"),
        }
    return {
        "current_patch": patch,
        "previous_patch": previous_patch,
        "patch_started_at": patch_started_at,
        "collected_at": collected_at,
        "min_games_for_tier": MIN_GAMES_FOR_TIER,
        "modes": modes,
    }


def _write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


LEVEL_KEYS = (
    ("level_one", 1),
    ("level_four", 4),
    ("level_seven", 7),
    ("level_ten", 10),
    ("level_thirteen", 13),
    ("level_sixteen", 16),
    ("level_twenty", 20),
)


def normalize_builds(raw: Any, *, patch: str, game_type: str, collected_at: str) -> dict[str, Any]:
    """`/heroes/talents/builds/all` → latest/builds.json: per hero a list of popular builds
    (games, win_rate, seven talents by level). Heroes that answered `{"error": ...}` get []."""
    if not isinstance(raw, dict) or not raw:
        raise ValueError("empty builds payload")
    heroes: dict[str, list[dict[str, Any]]] = {}
    for hero, builds in raw.items():
        out: list[dict[str, Any]] = []
        if isinstance(builds, list):
            for b in builds:
                if not isinstance(b, dict):
                    continue
                talents = []
                for key, level in LEVEL_KEYS:
                    t = b.get(key)
                    if isinstance(t, dict) and t.get("talent_name"):
                        talents.append(
                            {
                                "level": level,
                                "name": str(t["talent_name"]),
                                "title": str(t.get("title", "")),
                            }
                        )
                out.append(
                    {
                        "games": int(_num(b, "games_played")),
                        "win_rate": round(_num(b, "win_rate"), 2),
                        "talents": talents,
                    }
                )
        heroes[str(hero)] = out
    return {"patch": patch, "game_type": game_type, "collected_at": collected_at, "heroes": heroes}


def commit_atomic(
    *,
    data_dir: Path,
    tmp_dir: Path,
    snapshots: dict[str, dict[str, Any]],
    meta: dict[str, Any],
    prev_meta: dict[str, Any] | None,
    extra_files: dict[str, Any] | None = None,
) -> None:
    """Stage everything under tmp_dir, then swap directories in one rename set.

    If anything fails while staging, data/latest and data/previous are untouched.
    On a patch change the current latest/ becomes previous/ in the same swap.
    """
    stage = tmp_dir / "stage"
    if stage.exists():
        shutil.rmtree(stage)
    stage_latest = stage / "latest"
    stage_latest.mkdir(parents=True)
    for key, snap in snapshots.items():
        _write_json(stage_latest / f"{key}.json", snap)
    for name, obj in (extra_files or {}).items():
        _write_json(stage_latest / name, obj)
    _write_json(stage_latest / "meta.json", meta)

    patch_changed = (
        prev_meta is not None and prev_meta.get("current_patch") != meta["current_patch"]
    )
    latest = data_dir / "latest"
    previous = data_dir / "previous"
    stage_previous: Path | None = None
    if patch_changed and latest.exists():
        stage_previous = stage / "previous"
        shutil.copytree(latest, stage_previous)

    # swap: keep the old trees around until the new ones are in place, then delete
    data_dir.mkdir(parents=True, exist_ok=True)
    old_latest = tmp_dir / "old_latest"
    old_previous = tmp_dir / "old_previous"
    for p in (old_latest, old_previous):
        if p.exists():
            shutil.rmtree(p)
    if latest.exists():
        latest.rename(old_latest)
    stage_latest.rename(latest)
    if stage_previous is not None:
        if previous.exists():
            previous.rename(old_previous)
        stage_previous.rename(previous)
    for p in (old_latest, old_previous, stage):
        if p.exists():
            shutil.rmtree(p)
    log.info(
        "snapshot.committed",
        patch=meta["current_patch"],
        modes=sorted(snapshots),
        patch_changed=patch_changed,
    )

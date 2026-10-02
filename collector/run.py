"""One daily collection run: patch → four group_by_map calls + builds → atomic commit → matchups."""

from __future__ import annotations

import asyncio
import gzip
import json
import shutil
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import structlog

from collector.client import HPClient, HPError, SleepFn
from collector.config import Settings
from collector.matchups import collect_matchups, load_hero_list
from collector.models import JobSpec
from collector.party import apply_party_correction
from collector.patchnotes import collect_patchnotes
from collector.snapshot import (
    CELL_SOLO_SPECS,
    CELL_SPECS,
    REFERENCE_MODES,
    SPECS,
    VIEWS,
    build_meta,
    choose_patch,
    commit_atomic,
    heroes_without_assets,
    load_meta,
    normalize_builds,
    normalize_by_map,
    patch_line,
    refresh_previous_modes,
    snapshot_to_json,
    sum_regions,
    timeframe_of,
)

BUILDS_GAME_TYPE = "qm,sl"
BUILDS_TOTAL = 5


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


async def _collect_builds(
    c: HPClient,
    settings: Settings,
    *,
    patch: str,
    timeframe: str,
    collected_at: str,
    sleep: SleepFn,
) -> tuple[Any, dict[str, Any]] | None:
    """One `/heroes/talents/builds/all` call (1 req/min, 7 per week on Basic). Returns None when
    the weekly allowance is spent — the caller keeps yesterday's builds.json in that case."""
    await sleep(settings.map_call_spacing_seconds)
    params = {
        "timeframe_type": "minor",
        "timeframe": timeframe,
        "game_type": BUILDS_GAME_TYPE,
        "talentbuildtype": "Popular",
        "total_builds": str(BUILDS_TOTAL),
        "mode": "json",
    }
    log.info("run.call", key="builds", patch=patch)
    try:
        raw = await c.get_json("/heroes/talents/builds/all", params=params)
    except HPError as e:
        if e.code in {"quota_exceeded", "rate_limited"} or e.status == 429:
            log.warning("run.builds_skipped", code=e.code, message=e.message)
            return None
        raise
    builds = normalize_builds(
        raw, patch=patch, game_type=BUILDS_GAME_TYPE, collected_at=collected_at
    )
    log.info("run.normalized", key="builds", heroes=len(builds["heroes"]))
    return raw, builds


log = structlog.get_logger(__name__)


def utc_now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def snapshot_day(collected_at: str) -> str:
    """The run's day on the Korean calendar (UTC+9, no DST), which names its snapshot folder:
    the daily run is at 03:20 KST, still the day before in UTC."""
    when = datetime.fromisoformat(collected_at.replace("Z", "+00:00"))
    return (when + timedelta(hours=9)).strftime("%Y-%m-%d")


def _write_gz(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


async def _collect_all(
    c: HPClient,
    settings: Settings,
    *,
    patch: str,
    timeframe: str,
    collected_at: str,
    sleep: SleepFn,
    specs: tuple[JobSpec, ...] = SPECS,
    after_a_call: bool = False,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """group_by_map calls for one patch (`timeframe`: its builds), 60 s apart → (raw by key,
    snapshots by key).
    `after_a_call`: a group_by_map call was made just before, so wait before the first one too."""
    raw_by_key: dict[str, Any] = {}
    snapshots: dict[str, dict[str, Any]] = {}
    for i, spec in enumerate(specs):
        if i > 0 or after_a_call:
            # group_by_map=true drops the per-key limit to 1 request/minute
            await sleep(settings.map_call_spacing_seconds)
        params: dict[str, Any] = {
            "timeframe_type": "minor",
            "timeframe": timeframe,
            "game_type": spec.game_type,
            "group_by_map": "true",
            "mode": "json",
        }
        if spec.league_tier:
            params["league_tier"] = ",".join(str(t) for t in spec.league_tier)
        if spec.region:
            params["region"] = spec.region
        if spec.groupsize:
            params["groupsize"] = spec.groupsize
        log.info(
            "run.call",
            key=spec.key,
            game_type=spec.game_type,
            league_tier=params.get("league_tier"),
            region=spec.region,
            groupsize=spec.groupsize,
            patch=patch,
        )
        raw = await c.get_json("/heroes/stats", params=params)
        raw_by_key[spec.key] = raw
        snap = normalize_by_map(
            raw,
            key=spec.key,
            game_type=spec.game_type,
            league_tier=spec.league_tier,
            patch=patch,
            collected_at=collected_at,
        )
        snap.region = spec.region
        snapshots[spec.key] = snapshot_to_json(snap)
        log.info("run.normalized", key=spec.key, matches=snap.matches, rows=len(snap.rows))
    return raw_by_key, snapshots


async def _collect_cube(
    c: HPClient,
    settings: Settings,
    *,
    patch: str,
    timeframe: str,
    collected_at: str,
    sleep: SleepFn,
    views: tuple[str, ...] = VIEWS,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """Every view in every region (CELL_SPECS), then each one's solo twin; every view gets the
    party correction, and the whole of each view is the sum of its regions (corrected with the
    summed solo games) → (raw by key, snapshots by key). Any failure raises: a whole without
    one region, or a view without its correction, would be a different number under the same
    name (owner 2026-10-01 / 10-02), so the caller keeps yesterday's files."""
    cells = tuple(spec for spec in CELL_SPECS if _view_of(spec.key) in views)
    solos = tuple(spec for spec in CELL_SOLO_SPECS if _view_of(spec.key[: -len("_solo")]) in views)
    raw, parts = await _collect_all(
        c,
        settings,
        patch=patch,
        timeframe=timeframe,
        collected_at=collected_at,
        sleep=sleep,
        specs=cells,
    )
    try:
        solo_raw, solo = await _collect_all(
            c,
            settings,
            patch=patch,
            timeframe=timeframe,
            collected_at=collected_at,
            sleep=sleep,
            specs=solos,
            after_a_call=True,
        )
        out: dict[str, dict[str, Any]] = {
            key: apply_party_correction(snap, solo[f"{key}_solo"]) for key, snap in parts.items()
        }
        for view in views:
            keys = [spec.key for spec in cells if _view_of(spec.key) == view]
            whole = sum_regions([parts[k] for k in keys], key=view, collected_at=collected_at)
            whole_solo = sum_regions(
                [solo[f"{k}_solo"] for k in keys], key=f"{view}_solo", collected_at=collected_at
            )
            out[view] = apply_party_correction(whole, whole_solo)
    except HPError as e:
        log.error("run.party_failed", status=e.status, code=e.code)
        raise
    except ValueError as e:
        log.error("run.party_failed", error=str(e))
        raise
    for view in views:
        log.info("run.party", view=view, **out[view]["party"])
    return {**raw, **solo_raw}, out


def _view_of(cell_key: str) -> str:
    """`sl_low_kr` → `sl_low`."""
    return cell_key.rsplit("_", 1)[0]


async def _timeframe(c: HPClient, patch: str) -> str:
    """HP `timeframe` for a patch (its builds) from `/patches` (1,000,000/week)."""
    return timeframe_of(await c.get_json("/patches"), patch)


def _write_atomic(path: Path, obj: Any) -> None:
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def _warn_heroes_without_assets(
    data_dir: Path, snapshots: dict[str, dict[str, Any]], builds: dict[str, Any] | None
) -> None:
    """A new hero is in the stats before it has a Korean name and portrait; the site hides it."""
    missing = heroes_without_assets(data_dir, snapshots, builds)
    if missing is None:
        log.warning("run.hero_table_missing", path=str(data_dir / "heroes_ko.json"))
    elif missing:
        log.warning(
            "run.heroes_without_assets",
            heroes=missing,
            fix="rerun tools/build_assets.py with a heroes-data build that has them",
        )


def _client(settings: Settings, sleep: SleepFn) -> HPClient:
    return HPClient(
        base_url=settings.hp_base_url,
        token=settings.hp_api_token.get_secret_value(),
        sleep=sleep,
        poll_interval_default=settings.poll_interval_default,
        poll_max_seconds=settings.poll_max_seconds,
        timeout=settings.request_timeout,
    )


async def run_backfill_previous(
    settings: Settings,
    *,
    patch: str,
    sleep: SleepFn = asyncio.sleep,
    now: Callable[[], str] = utc_now_iso,
    client: HPClient | None = None,
) -> int:
    """One-off: collect an older patch (x.y.z, every build of it; or one build) into
    data/previous/ so "vs previous patch" deltas exist before the first natural patch change.
    Exit 2 = refused (no latest yet, or the current patch)."""
    prev_meta = load_meta(settings.data_dir)
    if prev_meta is None:
        log.error(
            "backfill.refused",
            reason="no data/latest/meta.json yet — run the normal collection first",
        )
        return 2
    if patch_line(patch) == patch_line(str(prev_meta.get("current_patch") or "")):
        log.error("backfill.refused", reason="that is the current patch", patch=patch)
        return 2
    collected_at = now()
    own = client is None
    c = client or _client(settings, sleep)
    try:
        timeframe = await _timeframe(c, patch)
        raw_by_key, snapshots = await _collect_cube(
            c, settings, patch=patch, timeframe=timeframe, collected_at=collected_at, sleep=sleep
        )
    except HPError as e:
        log.error("run.api_failed", status=e.status, code=e.code, message=e.message)
        return 1
    except ValueError as e:
        log.error("run.bad_payload", error=str(e))
        return 1
    finally:
        if own:
            await c.__aexit__(None, None, None)

    stage = settings.tmp_dir / "stage_previous"
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    for key, snap in snapshots.items():
        (stage / f"{key}.json").write_text(
            json.dumps(snap, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
    previous = settings.data_dir / "previous"
    old = settings.tmp_dir / "old_previous"
    if old.exists():
        shutil.rmtree(old)
    if previous.exists():
        previous.rename(old)
    stage.rename(previous)
    if old.exists():
        shutil.rmtree(old)
    meta = {**prev_meta, "previous_patch": patch}
    (settings.data_dir / "latest" / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    refresh_previous_modes(settings.data_dir)
    day_dir = settings.snapshot_out_dir / snapshot_day(collected_at)
    for key, raw in raw_by_key.items():
        _write_gz(day_dir / f"backfill_{patch}_raw_{key}.json.gz", raw)
        if key in snapshots:
            _write_gz(day_dir / f"backfill_{patch}_{key}.json.gz", snapshots[key])
    log.info("backfill.done", patch=patch, modes=sorted(snapshots))
    return 0


async def run(
    settings: Settings,
    *,
    sleep: SleepFn = asyncio.sleep,
    now: Callable[[], str] = utc_now_iso,
    client: HPClient | None = None,
    only: tuple[str, ...] | None = None,
) -> int:
    """Returns a process exit code. Never raises for API failures; never logs the token.
    `only`: the views to collect (keys of SPECS, QM and SL among them — they decide the patch),
    each in every region; for a recovery run on what is left of the week's quota."""
    views = VIEWS
    if only is not None:
        if not set(REFERENCE_MODES) <= set(only) <= set(views):
            log.error("run.refused", reason="--only takes qm and sl, and sl_low / sl_high")
            return 2
        views = tuple(v for v in views if v in only)
    collected_at = now()
    own_client = client is None
    c = client or _client(settings, sleep)
    try:
        code = await _run_stats(c, settings, collected_at=collected_at, sleep=sleep, views=views)
        if code == 0:
            await _run_matchups(c, settings, collected_at=collected_at, sleep=sleep)
        # Blizzard's notes do not depend on HP: collected even when the stats failed
        await _run_patchnotes(c, settings, collected_at=collected_at)
        return code
    finally:
        if own_client:
            await c.__aexit__(None, None, None)


async def _run_patchnotes(c: HPClient, settings: Settings, *, collected_at: str) -> None:
    """Best effort: a failure keeps yesterday's file and never fails the run."""
    path = settings.data_dir / "patchnotes.json"
    try:
        try:
            patches = await c.get_json("/patches")  # 1,000,000/week
        except HPError as e:
            log.warning("run.patchnotes_no_builds", status=e.status, code=e.code)
            patches = {"patches": []}  # known notes keep their build; new ones get it next time
        heroes = _load_json(settings.data_dir / "heroes_ko.json") or {"heroes": []}
        # a client of its own: the HP token must never reach another host
        async with httpx.AsyncClient(
            timeout=settings.request_timeout, follow_redirects=True
        ) as http:
            out = await collect_patchnotes(
                http,
                patches,
                heroes,
                existing=_load_json(path),
                now=datetime.fromisoformat(collected_at.replace("Z", "+00:00")),
                limit=settings.patchnotes_limit,
            )
    except Exception as e:  # noqa: BLE001 — a side step: log it and keep yesterday's file
        log.warning("run.patchnotes_failed", error=type(e).__name__, detail=str(e)[:200])
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    tmp.replace(path)
    log.info("run.patchnotes", notes=len(out["notes"]))


async def _run_matchups(
    c: HPClient, settings: Settings, *, collected_at: str, sleep: SleepFn
) -> None:
    """After the stats are committed: every due hero's matchups (never fails the run — a hero
    that could not be collected keeps its previous file and stays due for tomorrow)."""
    heroes = load_hero_list(settings.data_dir)
    meta = load_meta(settings.data_dir)
    if not heroes or meta is None:
        log.info("matchups.skipped", reason="no heroes_ko.json or meta.json")
        return
    patch = str(meta.get("reference_patch") or meta["current_patch"])  # decided once, in build_meta
    try:
        timeframe = await _timeframe(c, patch)
    except (HPError, ValueError) as e:
        log.warning("matchups.skipped", reason="no builds for the patch", error=str(e))
        return
    res = await collect_matchups(
        c,
        settings,
        heroes=heroes,
        patch=patch,
        timeframe=timeframe,
        collected_at=collected_at,
        sleep=sleep,
    )
    if res.written:
        out = settings.data_dir / "matchups"
        bundle = {slug: _load_json(out / f"{slug}.json") for slug in res.written}
        _write_gz(
            settings.snapshot_out_dir / snapshot_day(collected_at) / "matchups.json.gz", bundle
        )


async def _run_stats(
    c: HPClient,
    settings: Settings,
    *,
    collected_at: str,
    sleep: SleepFn,
    views: tuple[str, ...] = VIEWS,
) -> int:
    try:
        patches = await c.get_json("/patches")
        at = datetime.fromisoformat(collected_at.replace("Z", "+00:00"))
        patch = choose_patch(patches, now=at)
        timeframe = timeframe_of(patches, patch, now=at)
        log.info("run.patch", patch=patch, builds=timeframe, collected_at=collected_at)
        raw_by_key, snapshots = await _collect_cube(
            c,
            settings,
            patch=patch,
            timeframe=timeframe,
            collected_at=collected_at,
            sleep=sleep,
            views=views,
        )
        prev_meta = load_meta(settings.data_dir)
        meta = build_meta(prev_meta, patch=patch, collected_at=collected_at, snapshots=snapshots)
        # builds follow the one reference patch, like every page (thin new patch → previous)
        builds_result = await _collect_builds(
            c,
            settings,
            patch=meta["reference_patch"],
            timeframe=timeframe_of(patches, meta["reference_patch"], now=at),
            collected_at=collected_at,
            sleep=sleep,
        )
    except HPError as e:
        log.error("run.api_failed", status=e.status, code=e.code, message=e.message)
        return 1
    except ValueError as e:
        log.error("run.bad_payload", error=str(e))
        return 1

    extra: dict[str, Any] = {}
    if builds_result is not None:
        extra["builds.json"] = builds_result[1]
    else:
        kept = _load_json(settings.data_dir / "latest" / "builds.json")
        if kept is not None:
            extra["builds.json"] = kept
    commit_atomic(
        data_dir=settings.data_dir,
        tmp_dir=settings.tmp_dir,
        snapshots=snapshots,
        meta=meta,
        prev_meta=prev_meta,
        extra_files=extra,
    )
    refresh_previous_modes(settings.data_dir)
    if builds_result is not None:
        day_dir_b = settings.snapshot_out_dir / snapshot_day(collected_at)
        _write_gz(day_dir_b / "raw_builds.json.gz", builds_result[0])
        _write_gz(day_dir_b / "builds.json.gz", builds_result[1])
    day_dir = settings.snapshot_out_dir / snapshot_day(collected_at)
    for key, raw in raw_by_key.items():
        _write_gz(day_dir / f"raw_{key}.json.gz", raw)
        if key in snapshots:
            _write_gz(day_dir / f"{key}.json.gz", snapshots[key])
    for view in views:
        _write_gz(day_dir / f"{view}.json.gz", snapshots[view])
    (day_dir / "meta.json").parent.mkdir(parents=True, exist_ok=True)
    (day_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    _warn_heroes_without_assets(settings.data_dir, snapshots, extra.get("builds.json"))
    log.info("run.done", patch=patch, day=collected_at[:10], modes=sorted(snapshots))
    return 0

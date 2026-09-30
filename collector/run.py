"""One daily collection run: patch → four group_by_map calls + builds → atomic commit → matchups."""

from __future__ import annotations

import asyncio
import gzip
import json
import shutil
from collections.abc import Callable
from datetime import UTC, date, datetime
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
    REGION_KEYS,
    REGIONS,
    SOLO_OF,
    SOLO_SPECS,
    SPECS,
    build_meta,
    choose_patch,
    commit_atomic,
    heroes_without_assets,
    load_meta,
    normalize_builds,
    normalize_by_map,
    refresh_previous_modes,
    region_for_day,
    region_specs,
    snapshot_to_json,
)

BUILDS_GAME_TYPE = "qm,sl"
BUILDS_TOTAL = 5


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


async def _collect_builds(
    c: HPClient, settings: Settings, *, patch: str, collected_at: str, sleep: SleepFn
) -> tuple[Any, dict[str, Any]] | None:
    """One `/heroes/talents/builds/all` call (1 req/min, 7 per week on Basic). Returns None when
    the weekly allowance is spent — the caller keeps yesterday's builds.json in that case."""
    await sleep(settings.map_call_spacing_seconds)
    params = {
        "timeframe_type": "minor",
        "timeframe": patch,
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


def _write_gz(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


async def _collect_all(
    c: HPClient,
    settings: Settings,
    *,
    patch: str,
    collected_at: str,
    sleep: SleepFn,
    specs: tuple[JobSpec, ...] = SPECS,
    after_a_call: bool = False,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """group_by_map calls for one build, 60 s apart → (raw by key, snapshots by key).
    `after_a_call`: a group_by_map call was made just before, so wait before the first one too."""
    raw_by_key: dict[str, Any] = {}
    snapshots: dict[str, dict[str, Any]] = {}
    for i, spec in enumerate(specs):
        if i > 0 or after_a_call:
            # group_by_map=true drops the per-key limit to 1 request/minute
            await sleep(settings.map_call_spacing_seconds)
        params: dict[str, Any] = {
            "timeframe_type": "minor",
            "timeframe": patch,
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


async def _collect_region(
    c: HPClient, settings: Settings, *, patch: str, collected_at: str, sleep: SleepFn
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """Today's region (QM + SL). A failure here never fails the run: that region keeps its
    previous files (carried by `_carried_regions`) and comes round again in three days."""
    region = region_for_day(date.fromisoformat(collected_at[:10]))
    try:
        return await _collect_all(
            c,
            settings,
            patch=patch,
            collected_at=collected_at,
            sleep=sleep,
            specs=region_specs(region),
            after_a_call=True,
        )
    except HPError as e:
        log.warning("run.region_skipped", region=region, status=e.status, code=e.code)
    except ValueError as e:
        log.warning("run.region_skipped", region=region, error=str(e))
    return {}, {}


async def _collect_party(
    c: HPClient,
    settings: Settings,
    *,
    patch: str,
    collected_at: str,
    sleep: SleepFn,
    snapshots: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Solo-only QM + SL, folded into `snapshots` as the party correction (#36) → raw by key.
    A failure never fails the run: the views stay uncorrected and the page prints the formula
    without the correction."""
    try:
        raw, solo = await _collect_all(
            c,
            settings,
            patch=patch,
            collected_at=collected_at,
            sleep=sleep,
            specs=SOLO_SPECS,
            after_a_call=True,
        )
        corrected = {
            SOLO_OF[key]: apply_party_correction(snapshots[SOLO_OF[key]], snap)
            for key, snap in solo.items()
        }
    except HPError as e:
        log.warning("run.party_skipped", status=e.status, code=e.code)
        return {}
    except ValueError as e:
        log.warning("run.party_skipped", error=str(e))
        return {}
    snapshots.update(corrected)
    for view, snap in corrected.items():
        log.info("run.party", view=view, **snap["party"])
    return raw


def _region_patch(data_dir: Path, *, reference: str, current: str, day: str) -> str:
    """The patch today's region is collected on (#14). The pages show the reference patch, so it
    comes first; while that is the previous patch (final, it never changes) a region already in
    data/previous/ is not fetched again and the day's calls build the current patch's region, so
    it is there when the current patch becomes the reference."""
    if reference == current:
        return current
    region = region_for_day(date.fromisoformat(day[:10]))
    have = all(
        (_load_json(data_dir / "previous" / f"{m}_{region}.json") or {}).get("patch") == reference
        for m in ("qm", "sl")
    )
    return current if have else reference


def _write_atomic(path: Path, obj: Any) -> None:
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def _carried_regions(
    data_dir: Path, *, patch: str, fresh: dict[str, dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    """The other regions' files from data/latest, while they are for the same patch. On a patch
    change they are not carried: commit_atomic moves them into previous/ with the rest."""
    carried: dict[str, dict[str, Any]] = {}
    for key in REGION_KEYS:
        if key in fresh:
            continue
        old = _load_json(data_dir / "latest" / f"{key}.json")
        if isinstance(old, dict) and old.get("patch") == patch:
            carried[key] = old
    return carried


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


async def run_backfill_previous_regions(
    settings: Settings,
    *,
    sleep: SleepFn = asyncio.sleep,
    now: Callable[[], str] = utc_now_iso,
    client: HPClient | None = None,
) -> int:
    """One-off: every region (QM + SL) of the previous patch still missing in data/previous/.
    A finished patch never changes, so each is fetched once (owner 2026-09-30: 6 calls rather
    than three days of the daily rotation). Exit 2 = refused (no previous patch)."""
    meta = load_meta(settings.data_dir)
    patch = (meta or {}).get("previous_patch")
    if not patch:
        log.error("backfill_regions.refused", reason="no previous patch in data/latest/meta.json")
        return 2
    previous = settings.data_dir / "previous"
    specs = tuple(
        spec
        for region, _ in REGIONS
        for spec in region_specs(region)
        if (_load_json(previous / f"{spec.key}.json") or {}).get("patch") != patch
    )
    if not specs:
        log.info("backfill_regions.nothing_to_do", patch=patch)
        return 0
    collected_at = now()
    own = client is None
    c = client or _client(settings, sleep)
    try:
        _, snapshots = await _collect_all(
            c, settings, patch=patch, collected_at=collected_at, sleep=sleep, specs=specs
        )
    except HPError as e:
        log.error("run.api_failed", status=e.status, code=e.code, message=e.message)
        return 1
    finally:
        if own:
            await c.__aexit__(None, None, None)
    previous.mkdir(parents=True, exist_ok=True)
    for key, snap in snapshots.items():
        _write_atomic(previous / f"{key}.json", snap)
    refresh_previous_modes(settings.data_dir)
    log.info("backfill_regions.done", patch=patch, views=sorted(snapshots))
    return 0


async def run_backfill_previous(
    settings: Settings,
    *,
    patch: str,
    sleep: SleepFn = asyncio.sleep,
    now: Callable[[], str] = utc_now_iso,
    client: HPClient | None = None,
) -> int:
    """One-off: collect an older build into data/previous/ so "vs previous patch" deltas exist
    before the first natural patch change. Exit 2 = refused (no latest yet, or same build)."""
    prev_meta = load_meta(settings.data_dir)
    if prev_meta is None:
        log.error(
            "backfill.refused",
            reason="no data/latest/meta.json yet — run the normal collection first",
        )
        return 2
    if prev_meta.get("current_patch") == patch:
        log.error("backfill.refused", reason="that build is the current patch", patch=patch)
        return 2
    collected_at = now()
    own = client is None
    c = client or _client(settings, sleep)
    try:
        raw_by_key, snapshots = await _collect_all(
            c, settings, patch=patch, collected_at=collected_at, sleep=sleep
        )
        party_raw = await _collect_party(
            c, settings, patch=patch, collected_at=collected_at, sleep=sleep, snapshots=snapshots
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
    # region files are not backfilled (4 calls stay 4); keep the ones that are for this build
    for key in REGION_KEYS:
        kept = _load_json(previous / f"{key}.json")
        if isinstance(kept, dict) and kept.get("patch") == patch:
            shutil.copy2(previous / f"{key}.json", stage / f"{key}.json")
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
    day_dir = settings.snapshot_out_dir / collected_at[:10]
    for key, raw in raw_by_key.items():
        _write_gz(day_dir / f"backfill_{patch}_raw_{key}.json.gz", raw)
        _write_gz(day_dir / f"backfill_{patch}_{key}.json.gz", snapshots[key])
    for key, raw in party_raw.items():
        _write_gz(day_dir / f"backfill_{patch}_raw_{key}.json.gz", raw)
    log.info("backfill.done", patch=patch, modes=sorted(snapshots))
    return 0


async def run(
    settings: Settings,
    *,
    sleep: SleepFn = asyncio.sleep,
    now: Callable[[], str] = utc_now_iso,
    client: HPClient | None = None,
) -> int:
    """Returns a process exit code. Never raises for API failures; never logs the token."""
    collected_at = now()
    own_client = client is None
    c = client or _client(settings, sleep)
    try:
        code = await _run_stats(c, settings, collected_at=collected_at, sleep=sleep)
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
    res = await collect_matchups(
        c, settings, heroes=heroes, patch=patch, collected_at=collected_at, sleep=sleep
    )
    if res.written:
        out = settings.data_dir / "matchups"
        bundle = {slug: _load_json(out / f"{slug}.json") for slug in res.written}
        _write_gz(settings.snapshot_out_dir / collected_at[:10] / "matchups.json.gz", bundle)


async def _run_stats(c: HPClient, settings: Settings, *, collected_at: str, sleep: SleepFn) -> int:
    try:
        patches = await c.get_json("/patches")
        patch = choose_patch(
            patches, now=datetime.fromisoformat(collected_at.replace("Z", "+00:00"))
        )
        log.info("run.patch", patch=patch, collected_at=collected_at)
        raw_by_key, snapshots = await _collect_all(
            c, settings, patch=patch, collected_at=collected_at, sleep=sleep
        )
        party_raw = await _collect_party(
            c, settings, patch=patch, collected_at=collected_at, sleep=sleep, snapshots=snapshots
        )
        prev_meta = load_meta(settings.data_dir)
        reference = build_meta(
            prev_meta, patch=patch, collected_at=collected_at, snapshots=snapshots
        )["reference_patch"]
        region_patch = _region_patch(
            settings.data_dir, reference=reference, current=patch, day=collected_at
        )
        region_raw, region_snaps = await _collect_region(
            c, settings, patch=region_patch, collected_at=collected_at, sleep=sleep
        )
        raw_by_key.update(region_raw)
        region_previous: dict[str, dict[str, Any]] = {}
        if region_patch == patch:
            snapshots.update(region_snaps)
        else:
            region_previous = region_snaps
        snapshots.update(_carried_regions(settings.data_dir, patch=patch, fresh=snapshots))
        meta = build_meta(prev_meta, patch=patch, collected_at=collected_at, snapshots=snapshots)
        # builds follow the one reference patch, like every page (thin new patch → previous)
        builds_result = await _collect_builds(
            c, settings, patch=meta["reference_patch"], collected_at=collected_at, sleep=sleep
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
    if region_previous:
        previous = settings.data_dir / "previous"
        previous.mkdir(parents=True, exist_ok=True)
        for key, snap in region_previous.items():
            _write_atomic(previous / f"{key}.json", snap)
    refresh_previous_modes(settings.data_dir)
    if builds_result is not None:
        day_dir_b = settings.snapshot_out_dir / collected_at[:10]
        _write_gz(day_dir_b / "raw_builds.json.gz", builds_result[0])
        _write_gz(day_dir_b / "builds.json.gz", builds_result[1])
    day_dir = settings.snapshot_out_dir / collected_at[:10]
    for key, raw in raw_by_key.items():
        _write_gz(day_dir / f"raw_{key}.json.gz", raw)
        _write_gz(day_dir / f"{key}.json.gz", snapshots.get(key) or region_previous[key])
    for key, raw in party_raw.items():
        _write_gz(day_dir / f"raw_{key}.json.gz", raw)
    (day_dir / "meta.json").parent.mkdir(parents=True, exist_ok=True)
    (day_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    _warn_heroes_without_assets(settings.data_dir, snapshots, extra.get("builds.json"))
    log.info("run.done", patch=patch, day=collected_at[:10], modes=sorted(snapshots))
    return 0

"""One daily collection run: patch → five group_by_map calls → normalise → atomic commit."""

from __future__ import annotations

import asyncio
import gzip
import json
import shutil
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import structlog

from collector.client import HPClient, HPError, SleepFn
from collector.config import Settings
from collector.snapshot import (
    SPECS,
    build_meta,
    choose_patch,
    commit_atomic,
    load_meta,
    normalize_by_map,
    snapshot_to_json,
)

log = structlog.get_logger(__name__)


def utc_now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write_gz(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


async def _collect_all(
    c: HPClient, settings: Settings, *, patch: str, collected_at: str, sleep: SleepFn
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """The five group_by_map calls for one build, 60 s apart → (raw by key, snapshots by key)."""
    raw_by_key: dict[str, Any] = {}
    snapshots: dict[str, dict[str, Any]] = {}
    for i, spec in enumerate(SPECS):
        if i > 0:
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
        log.info(
            "run.call",
            key=spec.key,
            game_type=spec.game_type,
            league_tier=params.get("league_tier"),
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
        snapshots[spec.key] = snapshot_to_json(snap)
        log.info("run.normalized", key=spec.key, matches=snap.matches, rows=len(snap.rows))
    return raw_by_key, snapshots


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
    day_dir = settings.snapshot_out_dir / collected_at[:10]
    for key, raw in raw_by_key.items():
        _write_gz(day_dir / f"backfill_{patch}_raw_{key}.json.gz", raw)
        _write_gz(day_dir / f"backfill_{patch}_{key}.json.gz", snapshots[key])
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
        patches = await c.get_json("/patches")
        patch = choose_patch(patches)
        log.info("run.patch", patch=patch, collected_at=collected_at)
        raw_by_key, snapshots = await _collect_all(
            c, settings, patch=patch, collected_at=collected_at, sleep=sleep
        )
    except HPError as e:
        log.error("run.api_failed", status=e.status, code=e.code, message=e.message)
        return 1
    except ValueError as e:
        log.error("run.bad_payload", error=str(e))
        return 1
    finally:
        if own_client:
            await c.__aexit__(None, None, None)

    prev_meta = load_meta(settings.data_dir)
    meta = build_meta(prev_meta, patch=patch, collected_at=collected_at, snapshots=snapshots)
    commit_atomic(
        data_dir=settings.data_dir,
        tmp_dir=settings.tmp_dir,
        snapshots=snapshots,
        meta=meta,
        prev_meta=prev_meta,
    )
    day_dir = settings.snapshot_out_dir / collected_at[:10]
    for key, raw in raw_by_key.items():
        _write_gz(day_dir / f"raw_{key}.json.gz", raw)
        _write_gz(day_dir / f"{key}.json.gz", snapshots[key])
    (day_dir / "meta.json").parent.mkdir(parents=True, exist_ok=True)
    (day_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    log.info("run.done", patch=patch, day=collected_at[:10], modes=sorted(snapshots))
    return 0

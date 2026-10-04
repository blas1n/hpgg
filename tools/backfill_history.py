"""Rebuild data/history/<day>.json from the `snapshots` branch (주간 메타 리포트, 2026-10-05).

usage: uv run python tools/backfill_history.py 2026-10-02 2026-10-03 2026-10-04 2026-10-05

The report started after 2.57.0 had already run a week. Each archived day has the corrected whole
views (qm.json.gz, sl.json.gz) and every region's raw solo cell; the whole view's solo twin is the
sum of those cells, normalised and summed exactly as a run does. Then the weekly issues are built.
"""

from __future__ import annotations

import argparse
import gzip
import json
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any

import structlog

from collector.snapshot import CELL_SOLO_SPECS, normalize_by_map, snapshot_to_json, sum_regions
from collector.weekly import VIEWS, build_weekly, history_entry, write_history

log = structlog.get_logger(__name__)

Reader = Callable[[str], bytes | None]


def _json(read: Reader, name: str) -> Any:
    raw = read(name)
    if raw is None:
        return None
    return json.loads(gzip.decompress(raw) if name.endswith(".gz") else raw)


def entry_from_archive(day: str, read: Reader) -> dict[str, Any] | None:
    """The day's record from its archived files (`read` returns a file's bytes, or None)."""
    meta = _json(read, "meta.json")
    if meta is None:
        return None
    collected_at = meta["collected_at"]
    snapshots, solos = {}, {}
    for view in VIEWS:
        whole = _json(read, f"{view}.json.gz")
        cells = [s for s in CELL_SOLO_SPECS if s.key.rsplit("_", 2)[0] == view]
        raws = [(s, _json(read, f"raw_{s.key}.json.gz")) for s in cells]
        if whole is None or not raws or any(r is None for _, r in raws):
            log.warning("backfill.view_missing", day=day, view=view)
            continue
        parts = [
            snapshot_to_json(
                normalize_by_map(
                    raw,
                    key=s.key,
                    game_type=s.game_type,
                    league_tier=s.league_tier,
                    patch=whole["patch"],
                    collected_at=collected_at,
                )
            )
            for s, raw in raws
        ]
        snapshots[view] = whole
        solos[view] = sum_regions(parts, key=f"{view}_solo", collected_at=collected_at)
    if not snapshots:
        return None
    patch = next(iter(snapshots.values()))["patch"]
    return history_entry(
        day=day, collected_at=collected_at, patch=patch, snapshots=snapshots, solos=solos
    )


def _git_reader(day: str) -> Reader:
    def read(name: str) -> bytes | None:
        r = subprocess.run(
            ["git", "show", f"origin/snapshots:snapshots/{day}/{name}"], capture_output=True
        )
        return r.stdout if r.returncode == 0 else None

    return read


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("days", nargs="+", help="KST days whose snapshot folders to read (YYYY-MM-DD)")
    ap.add_argument("--data-dir", default="data")
    args = ap.parse_args()
    data_dir = Path(args.data_dir)
    for day in args.days:
        entry = entry_from_archive(day, _git_reader(day))
        if entry is None:
            log.warning("backfill.day_missing", day=day)
            continue
        write_history(data_dir, entry)
        log.info("backfill.day", day=day, patch=entry["patch"], views=sorted(entry["views"]))
    log.info("backfill.weekly", written=build_weekly(data_dir))


if __name__ == "__main__":
    main()

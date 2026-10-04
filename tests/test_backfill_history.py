"""Rebuild the weekly report's daily records from the snapshots branch (2026-10-05: the report
started after 2.57.0 had run a week; the archive has every day's normalised whole views and the
raw solo cells)."""

from __future__ import annotations

import gzip
import json
from typing import Any

from tools.backfill_history import entry_from_archive


def test_a_day_of_the_archive_becomes_the_same_record_a_run_writes(
    raw_by_map: dict[str, Any],
) -> None:
    whole = {
        "patch": "2.57.0",
        "mode": "qm",
        "matches": 60,
        "collected_at": "2026-10-04T18:20:20Z",
        "rows": [{"hero": "Illidan", "map": "all", "games": 300, "wins": 160, "bans": 30}],
    }
    files = {
        "meta.json": json.dumps(
            {"collected_at": "2026-10-04T18:20:20Z", "current_patch": "2.57.0"}
        ).encode(),
        "qm.json.gz": gzip.compress(json.dumps(whole).encode()),
        "sl.json.gz": gzip.compress(json.dumps({**whole, "mode": "sl"}).encode()),
    }
    for view in ("qm", "sl"):
        for r in ("kr", "na", "eu"):
            files[f"raw_{view}_{r}_solo.json.gz"] = gzip.compress(json.dumps(raw_by_map).encode())

    entry = entry_from_archive("2026-10-05", lambda name: files.get(name))
    assert entry["day"] == "2026-10-05" and entry["patch"] == "2.57.0"
    assert entry["views"]["qm"]["heroes"]["Illidan"] == [300, 160, 30]
    # solo = the three regions' solo cells summed (each region's Illidan: 300 games, 160 wins)
    assert entry["views"]["qm"]["solo"]["Illidan"] == [900, 480]


def test_a_day_without_its_files_is_skipped() -> None:
    assert entry_from_archive("2026-10-01", lambda name: None) is None

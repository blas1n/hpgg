"""The daily run is dispatched from the Mac mini at 03:20 KST; GitHub's own cron is only the
fallback (it started ~4 h late every night, 2026-09-29 → 10-01). A run that finds today's data
already collected must not spend the week's Heroes/Stats quota a second time."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from collector.freshness import is_fresh, main

NOW = datetime(2026, 10, 1, 22, 30, tzinfo=UTC)  # 07:30 KST, where GitHub's cron used to land


def _meta(tmp_path: Path, collected_at: str) -> Path:
    p = tmp_path / "meta.json"
    p.write_text(json.dumps({"collected_at": collected_at}))
    return p


def test_collected_at_dawn_is_fresh_when_the_late_cron_arrives(tmp_path: Path) -> None:
    assert is_fresh(_meta(tmp_path, "2026-10-01T19:10:00Z"), now=NOW, hours=12)


def test_yesterdays_data_is_stale(tmp_path: Path) -> None:
    # the Mac mini was off: yesterday's run → the fallback collects
    assert not is_fresh(_meta(tmp_path, "2026-09-30T22:28:36Z"), now=NOW, hours=12)


def test_no_meta_or_no_date_is_stale(tmp_path: Path) -> None:
    assert not is_fresh(tmp_path / "missing.json", now=NOW, hours=12)
    p = tmp_path / "meta.json"
    p.write_text("{}")
    assert not is_fresh(p, now=NOW, hours=12)


def test_main_prints_a_github_output_line(tmp_path: Path, capsys) -> None:
    path = _meta(tmp_path, datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"))
    assert main([str(path), "12"]) == 0
    assert capsys.readouterr().out.strip() == "fresh=true"
    assert main([str(tmp_path / "none.json"), "12"]) == 0
    assert capsys.readouterr().out.strip() == "fresh=false"

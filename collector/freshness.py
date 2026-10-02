"""`python3 -m collector.freshness <meta.json> <hours>` → `fresh=true|false` for $GITHUB_OUTPUT.

The daily run is dispatched from the Mac mini at 03:20 KST (tools/collect/); GitHub's cron is
only the fallback, because it started ~4 h late every night (2026-09-29 → 10-01). Whichever
arrives second finds today's data and must not spend the week's Heroes/Stats quota again.
Standard library only: the gate job runs it with the runner's python3, before any `uv sync`.
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path


def is_fresh(meta_path: Path, *, now: datetime, hours: float) -> bool:
    """True when meta.json's `collected_at` is less than `hours` old."""
    try:
        collected_at = json.loads(meta_path.read_text())["collected_at"]
        when = datetime.fromisoformat(collected_at.replace("Z", "+00:00"))
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    return now - when < timedelta(hours=hours)


def main(argv: list[str] | None = None) -> int:
    path, hours = (argv if argv is not None else sys.argv[1:])[:2]
    fresh = is_fresh(Path(path), now=datetime.now(UTC), hours=float(hours))
    print(f"fresh={'true' if fresh else 'false'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

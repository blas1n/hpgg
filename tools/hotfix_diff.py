"""Record one build's changed hero numbers in data/hotfixes.json (#62).

usage: uv run python tools/hotfix_diff.py --old <dir> --new <dir> --build 2.55.17.97650 \
           --previous 2.55.17.97605 --first-seen 2026-07-24T17:21:04Z

<dir> holds a build's hero XML as extracted from the CDN (mods/.../gamedata/...data.xml).
Files only one build has are skipped: a new hero has no numbers to compare.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import structlog

from collector.hotfixes import TalentIndex, hotfix_record, save_record

log = structlog.get_logger(__name__)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--old", type=Path, required=True)
    ap.add_argument("--new", type=Path, required=True)
    ap.add_argument("--build", required=True)
    ap.add_argument("--previous", required=True)
    ap.add_argument("--first-seen", required=True)
    ap.add_argument("--data", type=Path, default=Path("data"))
    a = ap.parse_args()
    files = []
    for f in sorted(a.new.rglob("*data.xml")):
        old = a.old / f.relative_to(a.new)
        if old.exists():
            files.append((old.read_text("utf-8"), f.read_text("utf-8")))
    rec = hotfix_record(
        build=a.build,
        previous=a.previous,
        first_seen=a.first_seen,
        files=files,
        index=TalentIndex.load(a.data),
    )
    save_record(a.data / "hotfixes.json", rec)
    log.info("hotfix.recorded", build=a.build, files=len(files), heroes=sorted(rec["heroes"]))


if __name__ == "__main__":
    main()

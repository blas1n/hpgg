"""Check a weekly report's names against the game's (collector/name_check.py).

usage: uv run python tools/check_names.py 2026-w41 [--data-dir data]
Exits 1 and lists each English name whose official Korean name is missing from the Korean text.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from collector.name_check import name_mismatches


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("week")
    ap.add_argument("--data-dir", default="data")
    args = ap.parse_args()
    data = Path(args.data_dir)
    analysis = json.loads((data / "weekly" / f"{args.week}.analysis.json").read_text("utf-8"))
    bad = name_mismatches(analysis, data)
    for m in bad:
        print(f"{m['kind']}: '{m['en']}' is '{m['ko']}' in Korean, not found in the Korean text")
    print("names ok" if not bad else f"{len(bad)} name(s) to fix")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()

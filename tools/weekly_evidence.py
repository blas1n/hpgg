"""The weekly report's evidence (collector/evidence.py) for one week.

usage: uv run python tools/weekly_evidence.py 2026-w40 [--data-dir data]
       → data/weekly/<week>.evidence.json, and a readable summary on stdout
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from collector.evidence import build_evidence, summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("week")
    ap.add_argument("--data-dir", default="data")
    args = ap.parse_args()
    data = Path(args.data_dir)
    ev = build_evidence(data, args.week)
    (data / "weekly" / f"{args.week}.evidence.json").write_text(
        json.dumps(ev, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(summary(ev))


if __name__ == "__main__":
    main()

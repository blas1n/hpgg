"""Re-derive data/hotfixes.json for known builds (#62): after a parser change, or to add history.

usage: uv run python tools/hotfix_backfill.py 2.55.17.97605 2.55.17.97650 2.55.17.97771 ...

Builds are compared in the order given, each against the one before it. Their BuildConfigs and
first-seen times come from tools/hotfix/builds.json (BlizzTrack's version history; add a row when
a build is missing). Needs tools/hotfix/build.sh run once.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import httpx
import structlog

from collector.cdn import BuildInfo, changed_hero_xml, fetch_files, parse_listing, parse_versions
from collector.hotfix_watch import HotfixSettings, casccdn_lister, live_archives
from collector.hotfixes import TalentIndex, hotfix_record, save_record

log = structlog.get_logger(__name__)
BUILDS = Path(__file__).resolve().parent / "hotfix" / "builds.json"


async def main(versions: list[str]) -> None:
    s = HotfixSettings()
    known = json.loads(BUILDS.read_text("utf-8"))
    missing = [v for v in versions if v not in known]
    if missing:
        raise SystemExit(f"not in {BUILDS.name}: {missing}")
    lister = casccdn_lister(s)
    listings = {}
    for v in versions:
        first_seen, build_config, cdn_config = known[v]
        listings[v] = parse_listing(await lister(BuildInfo(v, build_config, cdn_config)))
    index = TalentIndex.load(s.data_dir)
    async with httpx.AsyncClient(timeout=s.request_timeout, follow_redirects=True) as http:
        r = await http.get(s.ribbit_url)
        r.raise_for_status()
        live = parse_versions(r.text, s.region)
        archives = await live_archives(s, http, live.cdn_config)
        for prev, v in zip(versions, versions[1:], strict=False):
            changed = changed_hero_xml(listings[prev], listings[v])
            rows = [row for pair in changed for row in pair]
            got = await fetch_files(http, s.cdn_base, archives, rows, s.work_dir / "idx")
            rec = hotfix_record(
                build=v,
                previous=prev,
                first_seen=known[v][0][:19] + "Z",
                files=[(got[o.ckey], got[n.ckey]) for o, n in changed],
                index=index,
            )
            save_record(s.data_dir / "hotfixes.json", rec)
            log.info("hotfix.backfilled", build=v, files=len(changed), heroes=sorted(rec["heroes"]))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("versions", nargs="+")
    asyncio.run(main(ap.parse_args().versions))

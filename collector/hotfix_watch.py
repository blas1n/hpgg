"""The hotfix watcher (#62), run on the Mac mini every 30 minutes (tools/hotfix_watch.py).

A new live build on Ribbit → list its hero XML (CascLib, injected) → fetch only the files whose
content hash changed since the last build seen, by byte range → their changed talent numbers
into data/hotfixes.json. The first run only remembers the build: there is nothing to compare.
"""

from __future__ import annotations

import asyncio
import json
import shutil
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import httpx
import structlog
from pydantic_settings import BaseSettings, SettingsConfigDict

from collector.cdn import (
    BuildInfo,
    changed_hero_xml,
    fetch_files,
    parse_archives,
    parse_listing,
    parse_versions,
)
from collector.hotfixes import TalentIndex, hotfix_record, save_record

log = structlog.get_logger(__name__)

Lister = Callable[[BuildInfo], Awaitable[str]]


class HotfixSettings(BaseSettings):
    """HOTFIX_* environment; no HP token: the watcher only talks to Blizzard."""

    data_dir: Path = Path("data")
    work_dir: Path = Path("data/.tmp/hotfix")
    ribbit_url: str = "http://us.patch.battle.net:1119/hero/versions"
    cdn_base: str = "http://us.cdn.blizzard.com/tpr/Hero-Live-a"
    region: str = "us"
    casccdn: Path = Path("tools/hotfix/bin/casccdn")
    request_timeout: float = 60.0

    model_config = SettingsConfigDict(env_prefix="HOTFIX_", env_file=".env", extra="ignore")


@dataclass
class WatchResult:
    outcome: str  # unchanged | seeded | recorded
    build: str
    heroes: list[str] = field(default_factory=list)


def _hp(h: str) -> str:
    return f"{h[:2]}/{h[2:4]}/{h}"


def casccdn_lister(s: HotfixSettings) -> Lister:
    """List a build with tools/hotfix/bin/casccdn; its cache (encoding + root, ~150 MB a build)
    is deleted afterwards. A failed listing raises: an empty one would read as "no files"."""

    async def list_build(b: BuildInfo) -> str:
        cache = s.work_dir / "casc"
        try:
            proc = await asyncio.create_subprocess_exec(
                str(s.casccdn),
                str(cache),
                b.build_config,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            out, err = await proc.communicate()
            if proc.returncode != 0:
                raise RuntimeError(f"casccdn failed: {err.decode(errors='replace')[-300:]}")
            return out.decode("utf-8", errors="replace")
        finally:
            shutil.rmtree(cache, ignore_errors=True)

    return list_build


async def live_archives(s: HotfixSettings, http: httpx.AsyncClient, cdn_config: str) -> list[str]:
    """The archives of a CDN config: the live one resolves old builds' files too (an old
    config can 404)."""
    c = await http.get(f"{s.cdn_base}/config/{_hp(cdn_config)}")
    c.raise_for_status()
    return parse_archives(c.text)


async def watch_once(
    s: HotfixSettings, http: httpx.AsyncClient, lister: Lister, *, now: datetime
) -> WatchResult:
    r = await http.get(s.ribbit_url)
    r.raise_for_status()
    cur = parse_versions(r.text, s.region)
    state_path = s.work_dir / "state.json"
    state = json.loads(state_path.read_text("utf-8")) if state_path.exists() else None
    if state and state["version"] == cur.version:
        return WatchResult("unchanged", cur.version)

    listings = s.work_dir / "listings"
    listings.mkdir(parents=True, exist_ok=True)
    new_rows = parse_listing(await lister(cur))
    # keep only the hero XML rows: a full listing is 230 MB
    (listings / f"{cur.version}.tsv").write_text(
        "".join(f"{x.name}\t{x.ckey}\t{x.ekey}\t0\n" for x in new_rows.values()), "utf-8"
    )
    old_path = listings / f"{state['version']}.tsv" if state else None
    seen = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    def remember() -> None:
        state_path.write_text(json.dumps({"version": cur.version, "first_seen": seen}), "utf-8")

    if old_path is None or not old_path.exists():
        remember()
        log.info("hotfix.seeded", build=cur.version, files=len(new_rows))
        return WatchResult("seeded", cur.version)

    assert state is not None
    old_rows = parse_listing(old_path.read_text("utf-8"))
    changed = changed_hero_xml(old_rows, new_rows)
    files: list[tuple[str, str]] = []
    if changed:
        archives = await live_archives(s, http, cur.cdn_config)
        rows = [row for pair in changed for row in pair]
        got = await fetch_files(http, s.cdn_base, archives, rows, s.work_dir / "idx")
        files = [(got[o.ckey], got[n.ckey]) for o, n in changed]
    rec = hotfix_record(
        build=cur.version,
        previous=state["version"],
        first_seen=seen,
        files=files,
        index=TalentIndex.load(s.data_dir),
    )
    save_record(s.data_dir / "hotfixes.json", rec)
    remember()
    heroes = sorted(rec["heroes"])
    log.info("hotfix.recorded", build=cur.version, files=len(changed), heroes=heroes)
    return WatchResult("recorded", cur.version, heroes)

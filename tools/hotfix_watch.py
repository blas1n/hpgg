"""Watch Blizzard's live HotS build; on a new one, record its changed talent numbers and push (#62).

Run by launchd on the Mac mini every 30 minutes (tools/hotfix/com.blas1n.hpgg-hotfix.plist), from
its own clone of the repo: it pulls, runs collector/hotfix_watch.py, and pushes data/hotfixes.json
to main when a build was recorded (the push deploys). Needs tools/hotfix/build.sh run once.

usage: uv run python tools/hotfix_watch.py [--no-git]
"""

from __future__ import annotations

import argparse
import asyncio
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import httpx
import structlog

from collector.cdn import BuildInfo
from collector.hotfix_watch import HotfixSettings, Lister, watch_once

log = structlog.get_logger(__name__)
ROOT = Path(__file__).resolve().parent.parent


def _git(*args: str) -> None:
    subprocess.run(["git", "-C", str(ROOT), *args], check=True)


def _lister(s: HotfixSettings) -> Lister:
    async def list_build(b: BuildInfo) -> str:
        cache = s.work_dir / "casc"  # encoding + root, ~150 MB a build: not kept
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


async def main(use_git: bool) -> None:
    s = HotfixSettings()
    if use_git:
        _git("pull", "-q", "--rebase", "origin", "main")
    async with httpx.AsyncClient(timeout=s.request_timeout, follow_redirects=True) as http:
        res = await watch_once(s, http, _lister(s), now=datetime.now(UTC))
    log.info("hotfix.watch", outcome=res.outcome, build=res.build, heroes=res.heroes)
    if use_git and res.outcome == "recorded":
        _git("add", "data/hotfixes.json")
        _git(
            "-c",
            "user.name=hotsmeta-bot",
            "-c",
            "user.email=bot@hpgg.win",
            "commit",
            "-q",
            "-m",
            f"data: hotfix {res.build}",
        )
        _git("push", "-q", "origin", "HEAD:main")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-git", action="store_true", help="record locally, no pull/commit/push")
    asyncio.run(main(not ap.parse_args().no_git))

"""The workflows' security shape (2026-10-02 review).

A push to main is deployed on the Mac mini, so the key that can push there (DATA_DEPLOY_KEY)
must never sit in a job that runs third-party code or installs packages; and an action
referenced by tag can be moved under us, so every action is pinned to a commit."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
import yaml

WORKFLOWS = sorted((Path(__file__).parent.parent / ".github" / "workflows").glob("*.yml"))
SHA = re.compile(r"^[\w.-]+/[\w.-]+@[0-9a-f]{40}$")
GITHUB_OWN = ("actions/",)


def _jobs(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text())["jobs"]


def _uses(job: dict[str, Any]) -> list[str]:
    return [s["uses"] for s in job.get("steps", []) if "uses" in s]


def test_there_are_workflows() -> None:
    assert {p.name for p in WORKFLOWS} >= {"ci.yml", "collect-and-deploy.yml"}


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_every_action_is_pinned_to_a_commit(path: Path) -> None:
    unpinned = [u for job in _jobs(path).values() for u in _uses(job) if not SHA.match(u)]
    assert unpinned == []


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_every_workflow_grants_no_default_write(path: Path) -> None:
    perms = yaml.safe_load(path.read_text()).get("permissions")
    assert perms in ({}, {"contents": "read"})


def test_the_deploy_key_lives_in_one_job_that_runs_nothing_third_party() -> None:
    text = (Path(__file__).parent.parent / ".github/workflows/collect-and-deploy.yml").read_text()
    jobs = _jobs(Path(__file__).parent.parent / ".github/workflows/collect-and-deploy.yml")
    holders = [name for name, job in jobs.items() if "DATA_DEPLOY_KEY" in yaml.safe_dump(job)]
    assert holders == ["publish"]
    assert text.count("DATA_DEPLOY_KEY") >= 1
    publish = jobs["publish"]
    assert all(u.startswith(GITHUB_OWN) for u in _uses(publish))
    runs = " ".join(s.get("run", "") for s in publish["steps"])
    assert not re.search(r"\b(uv|pip|npm|npx|yarn|pnpm|curl|wget)\b", runs)


def test_the_jobs_that_run_packages_cannot_publish_or_push() -> None:
    jobs = _jobs(Path(__file__).parent.parent / ".github/workflows/collect-and-deploy.yml")
    for name, job in jobs.items():
        runs = " ".join(s.get("run", "") for s in job.get("steps", []))
        if re.search(r"\b(uv|npm)\b", runs):
            perms = job.get("permissions", {})
            assert perms.get("contents") == "read", name
            assert "pages" not in perms and "id-token" not in perms, name


def test_deploy_runs_whenever_build_succeeded() -> None:
    """2026-10-02: deploy had no `if` and needs only build, whose own needs (collect, publish)
    are skipped on a push or a fresh gate; GitHub then skips deploy too — the site stayed on
    the old build. Every job after a possibly skipped one needs an explicit always()."""
    jobs = _jobs(Path(__file__).parent.parent / ".github/workflows/collect-and-deploy.yml")
    cond = jobs["deploy"].get("if", "")
    assert "always()" in cond and "needs.build.result == 'success'" in cond


def test_publish_runs_after_a_plain_manual_dispatch() -> None:
    """2026-10-12: a plain `gh workflow run` skips `gate`; publish's condition had no always(),
    so GitHub skipped it with its skipped ancestor — the collected data never reached main (the
    Mac mini's dispatch passes if_stale and runs the gate, which hid it)."""
    jobs = _jobs(Path(__file__).parent.parent / ".github/workflows/collect-and-deploy.yml")
    cond = jobs["publish"].get("if", "")
    assert "always()" in cond and "needs.collect.result == 'success'" in cond


def test_the_collect_job_reads_the_archived_storm_league_records_before_collecting() -> None:
    """게임 시간대별 승률 (collector/hero_length.py) counts every archived day of the window: the
    collect job checks the snapshots branch's Storm League records out where the collector looks
    (Settings.replay_archive_dir), read only, before the collection runs."""
    jobs = _jobs(Path(__file__).parent.parent / ".github/workflows/collect-and-deploy.yml")
    steps = jobs["collect"]["steps"]
    runs = [s.get("run", "") for s in steps]
    fetch = next(i for i, r in enumerate(runs) if "git fetch" in r and " snapshots" in r)
    collect = next(i for i, r in enumerate(runs) if "python -m collector" in r)
    assert fetch < collect
    assert "data/.snapshots/snapshots" in runs[fetch] and "replays_sl" in runs[fetch]
    assert "push" not in runs[fetch]

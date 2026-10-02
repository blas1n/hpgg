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

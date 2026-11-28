"""The workflows' security shape (2026-10-02 review): an action referenced by tag can be moved
under us, so every action is pinned to a commit, and no workflow grants write by default.
(The collect-and-deploy workflow and its deploy-key checks went with the 2026-11-28 shutdown.)"""

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
    assert {p.name for p in WORKFLOWS} >= {"ci.yml"}


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_every_action_is_pinned_to_a_commit(path: Path) -> None:
    unpinned = [u for job in _jobs(path).values() for u in _uses(job) if not SHA.match(u)]
    assert unpinned == []


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_every_workflow_grants_no_default_write(path: Path) -> None:
    perms = yaml.safe_load(path.read_text()).get("permissions")
    assert perms in ({}, {"contents": "read"})

"""The owner MCP's tier list: the site's S–F table (web/src/formula.ts) recomputed in Python.

Both implementations check the same expected ranking (tests/fixtures/tier_formula_golden.json,
written by the TypeScript formula; web/tests/formula.test.ts checks it too), so a change to one
formula without the other fails a test.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from server.mcp.tiers import compute_tiers
from tests.server.mcp_support import call_tool
from tests.server.test_mcp_tools import owner  # noqa: F401  (fixture)

GOLDEN = Path(__file__).parents[1] / "fixtures" / "tier_formula_golden.json"


def golden() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(GOLDEN.read_text())
    return data


@pytest.mark.parametrize("case", ["all", "Dragon Shire"])
def test_same_ranking_as_the_site(case: str) -> None:
    g = golden()
    got = compute_tiers(g["cases"][case], g["min_games"])
    want = g["expected"][case]
    assert [(x.hero, x.tier, x.rank) for x in got.ranked] == [
        (x["hero"], x["tier"], x["rank"]) for x in want["ranked"]
    ]
    for mine, theirs in zip(got.ranked, want["ranked"], strict=True):
        assert mine.score == pytest.approx(theirs["score"], abs=1e-9)
    assert sorted(got.grey) == sorted(want["grey"])


def test_tier_list_default_view(owner: tuple[TestClient, str]) -> None:  # noqa: F811
    c, token = owner
    t = call_tool(c, token, "get_tier_list")
    assert t["view"] == {"mode": "sl", "bracket": "all", "region": "all", "map": "all"}
    assert t["patch"]
    assert t["min_games"] == 50
    assert t["formula"]
    first = t["heroes"][0]
    assert first["rank"] == 1 and first["tier"] == "S"
    assert set(first) >= {"hero", "hero_ko", "role", "tier", "rank", "score", "win_rate",
                          "pick", "ban_rate", "games"}  # fmt: skip
    ranks = [h["rank"] for h in t["heroes"]]
    assert ranks == sorted(ranks)
    assert all(g["games"] < 50 for g in t["unranked"])


def test_tier_list_filters(owner: tuple[TestClient, str]) -> None:  # noqa: F811
    c, token = owner
    kr = call_tool(c, token, "get_tier_list", region="kr", bracket="low")
    assert kr["view"]["region"] == "kr" and kr["view"]["bracket"] == "low"
    healers = call_tool(c, token, "get_tier_list", role="치유사")
    assert healers["heroes"] and all(h["role"] == "Healer" for h in healers["heroes"])
    # ranks stay those of the whole table, as on the site
    assert healers["heroes"][0]["rank"] >= 1
    shire = call_tool(c, token, "get_tier_list", map="용의 둥지")
    assert shire["view"]["map"] == "Dragon Shire"
    qm = call_tool(c, token, "get_tier_list", mode="qm", bracket="high")
    assert qm["view"]["bracket"] == "all"  # brackets are Storm League only


def test_tier_list_unknown_names(owner: tuple[TestClient, str]) -> None:  # noqa: F811
    c, token = owner
    assert call_tool(c, token, "get_tier_list", map="Nowhere")["error"] == "unknown_map"
    assert call_tool(c, token, "get_tier_list", role="Wizard")["error"] == "unknown_role"

"""The owner MCP's hero page (`get_hero`): every section of hpgg.win's 영웅 상세 as data.

The views the site computes in TypeScript (web/src/lib: matchupsView, heroBuilds, tiersView,
lengthView) are recomputed in Python; both check tests/fixtures/hero_views_golden.json, written by
the TypeScript, so the two copies cannot drift apart.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from server.mcp.hero import builds_view, length_view, matchups_view, strength_of, tiers_view
from tests.server.mcp_support import call_tool
from tests.server.test_mcp_tools import owner  # noqa: F401  (fixture)

GOLDEN = Path(__file__).parents[1] / "fixtures" / "hero_views_golden.json"


def golden() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(GOLDEN.read_text())
    return data


def close(a: Any, b: Any) -> None:
    """Same structure; floats equal to 1e-9."""
    if isinstance(a, float) or isinstance(b, float):
        assert a == pytest.approx(b, abs=1e-9)
    elif isinstance(a, dict):
        assert set(a) == set(b)
        for k in a:
            close(a[k], b[k])
    elif isinstance(a, list):
        assert len(a) == len(b)
        for x, y in zip(a, b, strict=True):
            close(x, y)
    else:
        assert a == b


HEROES = ["Malthael", "Ana", "Abathur"]


@pytest.mark.parametrize("hero", HEROES)
def test_matchups_as_the_site(hero: str) -> None:
    g = golden()
    got = matchups_view(g["matchups"][hero], strength_of(g["strength_rows"]))
    want = g["expected"][hero]["matchups"]
    keep = ("hero", "games", "win_rate", "expected", "delta", "score")
    close(
        {side: [{k: r[k] for k in keep} for r in got[side]] for side in ("counters", "synergies")},
        want,
    )


@pytest.mark.parametrize("hero", HEROES)
def test_builds_as_the_site(hero: str) -> None:
    g = golden()
    got = builds_view(g["builds"], hero, {})
    want = g["expected"][hero]["builds"]
    close(
        {
            k: [
                {
                    "games": b["games"],
                    "win_rate": b["win_rate"],
                    "pick": b["pick"],
                    "thin": b["thin"],
                    "talents": [t["title_en"] for t in b["talents"]],
                }
                for b in v
            ]
            for k, v in got.items()
        },
        want,
    )


@pytest.mark.parametrize("hero", HEROES)
def test_by_league_and_length_as_the_site(hero: str) -> None:
    g = golden()
    close(tiers_view(g["tiers"], hero), g["expected"][hero]["tiers"])
    close(length_view(g["length"], hero, g["window"]), g["expected"][hero]["length"])


def test_get_hero_every_section(owner: tuple[TestClient, str]) -> None:  # noqa: F811
    c, token = owner
    h = call_tool(c, token, "get_hero", hero="말티엘")
    assert h["hero"] == "Malthael" and h["hero_ko"] == "말티엘"
    assert h["view"] == {"mode": "sl", "bracket": "all", "region": "all", "map": "all"}
    s = h["summary"]
    assert s["kind"] in ("ranked", "unranked")
    assert {"tier", "rank", "win_rate", "games", "pick", "ban_rate", "prev_rank"} <= set(s)
    assert h["maps"] and {"map", "map_ko", "win_rate", "games", "thin"} <= set(h["maps"][0])
    assert [r["region"] for r in h["grid"]] == ["all", "kr", "na", "eu"]
    assert [c["bracket"] for c in h["grid"][0]["cells"]] == ["all", "low", "high"]
    assert [p["league"] for p in h["by_league"]["points"]] == [
        "bronze", "silver", "gold", "platinum", "diamond", "master",
    ]  # fmt: skip
    assert len(h["by_length"]["bands"]) == 3
    assert "counters" in h["matchups"] and "synergies" in h["matchups"]
    first = h["builds"]["all"][0]
    assert len(first["talents"]) == 7 and first["talents"][0]["ko"]
    assert isinstance(h["patch_changes"], list)
    assert h["rules"]  # the thresholds each section uses


def test_get_hero_view_and_map(owner: tuple[TestClient, str]) -> None:  # noqa: F811
    c, token = owner
    h = call_tool(c, token, "get_hero", hero="Ana", mode="qm", region="kr", map="용의 둥지")
    assert h["view"] == {"mode": "qm", "bracket": "all", "region": "kr", "map": "Dragon Shire"}
    assert [c["bracket"] for c in h["grid"][0]["cells"]] == ["all"]
    # Storm League-only sections stay world-wide Storm League, as on the site
    assert h["by_league"]["scope"] == "sl, all regions, all maps"


def test_get_hero_unknown(owner: tuple[TestClient, str]) -> None:  # noqa: F811
    c, token = owner
    assert call_tool(c, token, "get_hero", hero="Nobody")["error"] == "unknown_hero"

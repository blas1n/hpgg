"""`/heroes/matchups`: normalisation of the recorded live answer, the every-other-day gate, the
patch choice and the per-hero collection loop (quota, failures, time budget)."""

from __future__ import annotations

import gzip
import json
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from collector.client import HPClient
from collector.matchups import (
    MATCHUP_GAME_TYPE,
    collect_matchups,
    matchups_due,
    matchups_patch,
    normalize_matchups,
)
from tests.conftest import BASE, FIXTURES, TOKEN
from tests.test_run import settings

NOW = "2026-10-01T18:30:00Z"
LIVE = FIXTURES / "live_probe_matchups_abathur_sl_2.55.17.98025.json.gz"


def live_raw() -> dict[str, Any]:
    with gzip.open(LIVE, "rt", encoding="utf-8") as f:
        loaded: dict[str, Any] = json.load(f)
    return loaded


# --- normalisation (recorded 2026-09-29: Abathur, sl, minor 2.55.17.98025) -----------------


def test_live_fixture_has_the_recorded_shape() -> None:
    raw = live_raw()
    assert set(raw) == {"ally", "enemy", "combined"}
    row = raw["enemy"][0]
    assert set(row) == {"hero", "role", "wins", "losses", "games_played", "win_rate", "hovertext"}
    assert row["hero"]["name"] == "Fenix"


def test_normalize_keeps_the_heros_own_wins_on_both_sides() -> None:
    m = normalize_matchups(
        live_raw(), hero="Abathur", patch="2.55.17.98025", collected_at="2026-09-29T00:00:00Z"
    )
    assert (m["hero"], m["patch"], m["game_type"], m["collected_at"]) == (
        "Abathur",
        "2.55.17.98025",
        "sl",
        "2026-09-29T00:00:00Z",
    )
    # enemy win_rate in the payload is the LOSS rate ("Lost against a team with Fenix 59.62% of
    # games"); wins/losses are Abathur's on both lists
    fenix = next(r for r in m["enemy"] if r["hero"] == "Fenix")
    assert fenix == {"hero": "Fenix", "games": 104, "wins": 42, "win_rate": 40.38}
    samuro = next(r for r in m["ally"] if r["hero"] == "Samuro")
    assert samuro == {"hero": "Samuro", "games": 168, "wins": 105, "win_rate": 62.5}
    # the hero's own record, from the same sample: every game appears 4× in ally, 5× in enemy
    assert (m["games"], m["wins"], m["win_rate"]) == (4855, 2466, 50.79)
    # rows with no games (Xal'atath, not yet in this patch) are dropped
    assert len(m["ally"]) == 89 and len(m["enemy"]) == 89
    assert all(r["games"] > 0 for r in m["ally"] + m["enemy"])


def test_normalize_rejects_a_payload_without_rows() -> None:
    with pytest.raises(ValueError):
        normalize_matchups({"ally": [], "enemy": []}, hero="X", patch="p", collected_at=NOW)
    with pytest.raises(ValueError):
        normalize_matchups([], hero="X", patch="p", collected_at=NOW)


# --- gate: every other day, by the age of the hero's file -----------------------------------


def _file(patch: str, day: str) -> dict[str, Any]:
    return {"patch": patch, "collected_at": f"{day}T18:30:00Z"}


@pytest.mark.parametrize(
    ("existing", "today", "due"),
    [
        (None, "2026-10-01", True),  # no file yet
        (_file("2.55.17.98025", "2026-09-30"), "2026-10-01", False),  # collected yesterday
        (_file("2.55.17.98025", "2026-09-29"), "2026-10-01", True),  # 2 days old
        (_file("2.55.17.98025", "2026-09-26"), "2026-10-01", True),  # a missed run heals
        (_file("2.55.16.00000", "2026-09-30"), "2026-10-01", True),  # other patch → now
        (_file("2.55.17.98025", "2026-10-01"), "2026-10-01", False),  # same day rerun
        ({"patch": "2.55.17.98025"}, "2026-10-01", True),  # damaged file → recollect
    ],
)
def test_matchups_due(existing: dict[str, Any] | None, today: str, due: bool) -> None:
    assert matchups_due(existing, patch="2.55.17.98025", today=date.fromisoformat(today)) is due


# --- patch: the one the pages show (same thin-sample rule as web/src/data.ts thinSample) -----


def _meta(over: int, heroes: int = 90, previous: str | None = "2.55.17.98025") -> dict[str, Any]:
    return {
        "current_patch": "2.57.0.98285",
        "previous_patch": previous,
        "modes": {"sl": {"matches": 1, "heroes": heroes, "heroes_over_200": over}},
    }


def test_matchups_patch_follows_the_thin_sample_fallback() -> None:
    assert matchups_patch(_meta(0)) == "2.55.17.98025"  # thin → previous, as the pages
    assert matchups_patch(_meta(44)) == "2.55.17.98025"  # 44/90 < half
    assert matchups_patch(_meta(45)) == "2.57.0.98285"  # half → current
    assert matchups_patch(_meta(0, previous=None)) == "2.57.0.98285"  # nothing to fall back to
    assert matchups_patch({**_meta(0), "modes": {}}) == "2.57.0.98285"


# --- collection loop ------------------------------------------------------------------------

HEROES = [("Abathur", "abathur"), ("Alarak", "alarak"), ("Anub'arak", "anubarak")]


class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def client(fake_sleep: Any) -> HPClient:
    return HPClient(base_url=BASE, token=TOKEN, sleep=fake_sleep)


@respx.mock
async def test_collect_writes_one_file_per_hero_spaced_and_skips_fresh_ones(
    tmp_path: Path, fake_sleep: Any
) -> None:
    s = settings(tmp_path)
    out = s.data_dir / "matchups"
    out.mkdir(parents=True)
    fresh = {"patch": "2.55.17.98025", "collected_at": "2026-09-30T18:30:00Z", "hero": "Alarak"}
    (out / "alarak.json").write_text(json.dumps(fresh))
    route = respx.get(f"{BASE}/heroes/matchups").mock(
        return_value=httpx.Response(200, json=live_raw())
    )
    async with client(fake_sleep) as c:
        res = await collect_matchups(
            c,
            s,
            heroes=HEROES,
            patch="2.55.17.98025",
            collected_at="2026-10-01T18:30:00Z",
            sleep=fake_sleep,
        )
    assert (res.written, res.skipped_fresh, res.failed, res.stopped) == (
        ["abathur", "anubarak"],
        1,
        [],
        None,
    )
    qs = [dict(httpx.QueryParams(c.request.url.query)) for c in route.calls]
    assert [q["hero"] for q in qs] == ["Abathur", "Anub'arak"]
    assert all(
        (q["game_type"], q["timeframe_type"], q["timeframe"])
        == (MATCHUP_GAME_TYPE, "minor", "2.55.17.98025")
        for q in qs
    )
    assert all("group_by_map" not in q for q in qs)  # 60/min only without it
    assert fake_sleep.calls == [s.matchups_call_spacing_seconds]  # between calls, not before
    assert json.loads((out / "alarak.json").read_text()) == fresh
    written = json.loads((out / "abathur.json").read_text())
    assert written["collected_at"] == "2026-10-01T18:30:00Z" and written["hero"] == "Abathur"
    assert not list(out.glob("*.tmp"))


@respx.mock
async def test_quota_exceeded_stops_and_keeps_the_old_files(
    tmp_path: Path, fake_sleep: Any
) -> None:
    s = settings(tmp_path)
    out = s.data_dir / "matchups"
    out.mkdir(parents=True)
    old = {"patch": "2.55.17.98025", "collected_at": "2026-09-20T18:30:00Z", "hero": "Alarak"}
    (out / "alarak.json").write_text(json.dumps(old))
    route = respx.get(f"{BASE}/heroes/matchups")
    route.side_effect = [
        httpx.Response(200, json=live_raw()),
        httpx.Response(429, json={"error": {"code": "quota_exceeded", "message": "week"}}),
    ]
    async with client(fake_sleep) as c:
        res = await collect_matchups(
            c, s, heroes=HEROES, patch="2.55.17.98025", collected_at=NOW, sleep=fake_sleep
        )
    assert res.written == ["abathur"] and res.stopped == "quota_exceeded"
    assert route.call_count == 2  # Anub'arak never asked
    assert json.loads((out / "alarak.json").read_text()) == old


@respx.mock
async def test_one_hero_failing_does_not_stop_the_rest(tmp_path: Path, fake_sleep: Any) -> None:
    s = settings(tmp_path)
    route = respx.get(f"{BASE}/heroes/matchups")
    route.side_effect = [
        httpx.Response(422, json={"error": {"code": "invalid_parameters", "message": "hero"}}),
        httpx.Response(200, json={"ally": [], "enemy": []}),  # no rows → bad payload
        httpx.Response(200, json=live_raw()),
    ]
    async with client(fake_sleep) as c:
        res = await collect_matchups(
            c, s, heroes=HEROES, patch="2.55.17.98025", collected_at=NOW, sleep=fake_sleep
        )
    assert res.failed == ["abathur", "alarak"] and res.written == ["anubarak"]
    assert res.stopped is None


@respx.mock
async def test_time_budget_stops_the_loop(tmp_path: Path, fake_sleep: Any) -> None:
    s = settings(tmp_path, matchups_budget_seconds=100.0)
    clock = Clock()

    def answer(request: httpx.Request) -> httpx.Response:
        clock.t += 60.0  # a slow (cache-miss) answer
        return httpx.Response(200, json=live_raw())

    respx.get(f"{BASE}/heroes/matchups").mock(side_effect=answer)
    async with client(fake_sleep) as c:
        res = await collect_matchups(
            c,
            s,
            heroes=HEROES,
            patch="2.55.17.98025",
            collected_at=NOW,
            sleep=fake_sleep,
            clock=clock,
        )
    assert res.written == ["abathur", "alarak"] and res.stopped == "time_budget"

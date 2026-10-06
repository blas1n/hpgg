"""Per-game records for the weekly report (owner 2026-10-06: a meta analysis on games, not on
aggregates — what the central pick does to games, what is drafted into it, which builds of a
counter actually win). HP lists replays by id (`/replays?game_type=&after=`, 1,000 a page, oldest
first) and answers each in full (`/replay/{id}`: draft, ten players with talents, MMR and score
lines, the teams' experience each minute). A record keeps what the analysis needs and nothing that
names a player."""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

import httpx
import respx

from collector.config import Settings
from collector.replay_sample import compact, sample_replays
from collector.run import _client
from tests.conftest import BASE, TOKEN

FIX = Path(__file__).parent / "fixtures" / "replays"


def _detail() -> dict[str, Any]:
    with gzip.open(FIX / "replay_65753195_sl.json.gz", "rt", encoding="utf-8") as f:
        return json.load(f)


def _settings(tmp_path: Path, **kw: Any) -> Settings:
    return Settings(
        _env_file=None,
        hp_api_token=TOKEN,
        hp_base_url=BASE,
        data_dir=tmp_path / "data",
        tmp_dir=tmp_path / "tmp",
        snapshot_out_dir=tmp_path / "snap",
        **kw,
    )  # type: ignore[call-arg]


def test_a_record_keeps_the_draft_the_players_builds_and_the_experience_curve() -> None:
    r = compact(_detail(), replay_id=65753195, version="2.57.0.98304")
    assert r is not None
    assert (r["id"], r["type"], r["map"], r["length"], r["version"]) == (
        65753195,
        "sl",
        "Sky Temple",
        1104,
        "2.57.0.98304",
    )
    assert r["winner"] == 0
    # the draft in order: bans and picks with the team that made them; a skipped ban is None
    assert r["draft"][0] == ["b", 0, "Xal'atath"]
    assert r["draft"][1] == ["b", 1, "Alexstrasza"]
    assert r["draft"][2] == ["b", 0, None]
    # Storm League: the team that bans first picks first (A), then B B, A A…
    assert r["draft"][4] == ["p", 0, "Whitemane"]
    assert r["draft"][5][1] == r["draft"][6][1] == 1
    assert [d[0] for d in r["draft"]].count("p") == 10
    # ten players, each with the hero, the result, the party size, MMR, seven talents, the score
    assert len(r["players"]) == 10
    arthas = next(p for p in r["players"] if p["hero"] == "Arthas")
    assert arthas["team"] == 0 and arthas["win"] == 1
    assert arthas["mmr"] == 1927 and arthas["hero_mmr"] == 1907
    assert arthas["party"] >= 1
    assert arthas["talents"][0] == "ArthasMasteryFrostPresenceHowlingBlast"
    assert len(arthas["talents"]) == 7
    assert arthas["score"]["deaths"] == 1
    assert arthas["score"]["teamfight_hero_damage"] == 12027
    assert arthas["score"]["outnumbered_deaths"] == 1
    assert "kills_rank" not in arthas["score"]
    # each team's level and experience at each minute
    assert len(r["xp"][0]) == len(r["level"][0]) == 19
    assert r["level"][0][-1] == 22 and r["xp"][1][-1] == 85018


def test_a_record_names_no_player() -> None:
    text = json.dumps(compact(_detail(), replay_id=1, version="2.57.0.98304"))
    for key in ("battletag", "blizz_id", "account_level", "party_color"):
        assert key not in text
    assert "#0000" not in text


def test_an_unusable_answer_is_no_record() -> None:
    d = _detail()
    d["players"] = [[], []]
    assert compact(d, replay_id=1, version="v") is None


def _page(ids: list[int], version: str = "2.57.0.98348", after_max: int = 1000) -> dict:
    return {
        "replays": [
            {"replayID": i, "game_type": "Storm League", "game_version": version} for i in ids
        ],
        "next_after": ids[-1] if ids else None,
        "max_replay_id": after_max,
    }


@respx.mock
async def test_storm_league_is_taken_whole_from_the_cursor_on_this_patch_only(
    tmp_path: Path, fake_sleep: Any
) -> None:
    pages = {
        "100": {
            "replays": [
                {"replayID": 101, "game_type": "Storm League", "game_version": "2.55.17.97605"},
                {"replayID": 102, "game_type": "Storm League", "game_version": "2.57.0.98348"},
                {"replayID": 103, "game_type": "Storm League", "game_version": "2.57.0.98304"},
            ],
            "next_after": 103,
            "max_replay_id": 103,
        },
        "103": {"replays": [], "next_after": None, "max_replay_id": 103},
    }

    def listing(request: httpx.Request) -> httpx.Response:
        q = dict(httpx.QueryParams(request.url.query))
        assert q["game_type"] == "sl"
        return httpx.Response(200, json=pages[q["after"]])

    respx.get(f"{BASE}/replays").mock(side_effect=listing)
    fetched: list[str] = []

    def detail(request: httpx.Request) -> httpx.Response:
        fetched.append(request.url.path.rsplit("/", 1)[-1])
        return httpx.Response(200, json=_detail())

    respx.get(url__regex=rf"{BASE}/replay/\d+").mock(side_effect=detail)
    s = _settings(tmp_path, replay_qm_per_run=0)
    out = await sample_replays(
        _client(s, fake_sleep),
        s,
        patch="2.57.0",
        cursor={"sl": 100},
        sleep=fake_sleep,
    )
    assert fetched == ["102", "103"]  # 101 is the previous patch
    assert [r["id"] for r in out.records["sl"]] == [102, 103]
    assert out.cursor["sl"] == 103


@respx.mock
async def test_a_capped_run_takes_an_even_sample_of_what_was_listed_and_moves_on(
    tmp_path: Path, fake_sleep: Any
) -> None:
    # about 3,300 Storm League games are uploaded a day (2026-10-06): a sample spread over the
    # day, not the first ones of it
    respx.get(f"{BASE}/replays").mock(
        side_effect=lambda req: httpx.Response(
            200,
            json=_page([11, 12, 13, 14])
            if dict(httpx.QueryParams(req.url.query))["after"] == "10"
            else _page([]),
        )
    )
    respx.get(url__regex=rf"{BASE}/replay/\d+").mock(
        return_value=httpx.Response(200, json=_detail())
    )
    s = _settings(tmp_path, replay_sl_per_run=2, replay_qm_per_run=0)
    out = await sample_replays(
        _client(s, fake_sleep), s, patch="2.57.0", cursor={"sl": 10}, sleep=fake_sleep
    )
    assert [r["id"] for r in out.records["sl"]] == [11, 13]
    assert out.cursor["sl"] == 14


@respx.mock
async def test_quick_match_is_sampled_the_same_way(tmp_path: Path, fake_sleep: Any) -> None:
    def listing(request: httpx.Request) -> httpx.Response:
        q = dict(httpx.QueryParams(request.url.query))
        if q["game_type"] == "sl":
            return httpx.Response(200, json=_page([]))
        return httpx.Response(
            200, json=_page([21, 22, 23, 24, 25]) if q["after"] == "20" else _page([])
        )

    respx.get(f"{BASE}/replays").mock(side_effect=listing)
    qm = {**_detail(), "game_type": "Quick Match"}
    respx.get(url__regex=rf"{BASE}/replay/\d+").mock(return_value=httpx.Response(200, json=qm))
    s = _settings(tmp_path, replay_qm_per_run=2)
    out = await sample_replays(
        _client(s, fake_sleep), s, patch="2.57.0", cursor={"sl": 5, "qm": 20}, sleep=fake_sleep
    )
    assert [r["id"] for r in out.records["qm"]] == [21, 23]
    assert out.records["qm"][0]["type"] == "qm"
    assert out.cursor["qm"] == 25


@respx.mock
async def test_a_failed_game_is_skipped_and_the_time_budget_stops_the_run(
    tmp_path: Path, fake_sleep: Any
) -> None:
    respx.get(f"{BASE}/replays").mock(
        side_effect=lambda req: httpx.Response(
            200,
            json=_page([1, 2, 3])
            if dict(httpx.QueryParams(req.url.query))["after"] == "0"
            else _page([]),
        )
    )

    def detail(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/1"):
            return httpx.Response(404, json={"error": {"code": "not_found", "message": "x"}})
        return httpx.Response(200, json=_detail())

    respx.get(url__regex=rf"{BASE}/replay/\d+").mock(side_effect=detail)
    s = _settings(tmp_path, replay_qm_per_run=0)
    ticks = iter([0.0, 0.0, 0.0, 9999.0, 9999.0, 9999.0])
    out = await sample_replays(
        _client(s, fake_sleep),
        s,
        patch="2.57.0",
        cursor={"sl": 0},
        sleep=fake_sleep,
        clock=lambda: next(ticks),
    )
    assert [r["id"] for r in out.records["sl"]] == [2]
    assert out.cursor["sl"] == 3  # a sample: what the time budget cut is not chased


@respx.mock
async def test_without_a_cursor_it_starts_a_little_before_the_newest(
    tmp_path: Path, fake_sleep: Any
) -> None:
    asked: list[str] = []

    def listing(request: httpx.Request) -> httpx.Response:
        q = dict(httpx.QueryParams(request.url.query))
        asked.append(q.get("after", "-"))
        if "after" not in q:
            return httpx.Response(200, json=_page([1], after_max=50_000))
        return httpx.Response(200, json=_page([]))

    respx.get(f"{BASE}/replays").mock(side_effect=listing)
    s = _settings(tmp_path, replay_qm_per_run=0, replay_lookback_ids=3000)
    await sample_replays(_client(s, fake_sleep), s, patch="2.57.0", cursor={}, sleep=fake_sleep)
    assert asked[:2] == ["-", "47000"]

"""The weekly report's analysis on games (owner 2026-10-06): one central pick, and through it the
whole game — when it is banned or picked, how games with it go, what the other team drafts into
it, which builds of those answers win and in whose hands, and what differs when they win.
Records are collector/replay_sample.py's."""

from __future__ import annotations

from typing import Any

import pytest

from collector.replay_insights import (
    answered_by,
    build_split,
    draft_profile,
    game_shape,
    win_loss_contrast,
)

FILL = ["Muradin", "Uther", "Valla", "Sonya", "Jaina", "Johanna", "Rehgar", "Raynor", "Thrall"]


def game(
    gid: int,
    *,
    a: list[str],
    b: list[str],
    winner: int,
    draft: list[list[Any]] | None = None,
    length: int = 1200,
    lead: int = 0,
    talents: dict[str, list[str]] | None = None,
    mmr: int = 2000,
    score: dict[str, dict[str, float]] | None = None,
    kind: str = "sl",
) -> dict[str, Any]:
    """A game: team 0 = a, team 1 = b. `lead`: team 0's level lead from minute 5 on."""
    minutes = max(1, length // 60)
    lv0 = [min(30, 1 + m) for m in range(minutes)]
    lv1 = [max(1, v - (lead if m >= 5 else 0)) for m, v in enumerate(lv0)]
    talents = talents or {}
    score = score or {}
    players = [
        {
            "team": t,
            "hero": h,
            "win": int(winner == t),
            "party": 1,
            "mmr": mmr,
            "hero_mmr": mmr,
            "talents": talents.get(h, [f"{h}T{i}" for i in range(7)]),
            "score": {"deaths": 2, "hero_damage": 40000, **score.get(h, {})},
        }
        for t, team in enumerate((a, b))
        for h in team
    ]
    if draft is None:
        draft = [["b", 0, None], ["b", 1, None], ["b", 0, None], ["b", 1, None]]
        order = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1]
        left = [list(a), list(b)]
        draft += [["p", t, left[t].pop(0)] for t in order]
    return {
        "id": gid,
        "type": kind,
        "map": "Sky Temple",
        "length": length,
        "winner": winner,
        "draft": draft,
        "level": [lv0, lv1],
        "xp": [[0] * minutes, [0] * minutes],
        "players": players,
    }


X = "Xal'atath"
Z = "Zeratul"


def test_draft_profile_says_how_often_it_is_banned_and_when_it_is_picked() -> None:
    banned = game(
        1,
        a=["Valla", "Muradin", "Uther", "Sonya", "Jaina"],
        b=["Johanna", "Rehgar", "Raynor", "Thrall", "Tyrael"],
        winner=0,
    )
    banned["draft"][0] = ["b", 0, X]
    first_pick = game(2, a=[X, *FILL[:4]], b=FILL[4:9], winner=0)
    last_pick = game(3, a=FILL[:4] + [X], b=FILL[4:9], winner=1)
    p = draft_profile([banned, first_pick, last_pick], X)
    assert p["games"] == 3
    assert p["ban_rate"] == pytest.approx(100 / 3)
    assert p["first_ban_rate"] == pytest.approx(100 / 3)  # banned with the very first ban
    assert p["pick_rate"] == pytest.approx(200 / 3)
    assert p["picked"] == 2 and p["win_rate"] == pytest.approx(50.0)
    assert p["pick_round"] == {"first": 1, "middle": 0, "last": 1}


def test_game_shape_compares_games_with_it_and_without() -> None:
    games = [
        game(1, a=[X, *FILL[:4]], b=FILL[4:9], winner=0, length=900, lead=2),
        game(2, a=[X, *FILL[:4]], b=FILL[4:9], winner=0, length=1100, lead=1),
        game(3, a=FILL[:5], b=FILL[4:8] + ["Tyrael"], winner=1, length=1500, lead=0),
        game(4, a=FILL[:5], b=FILL[4:8] + ["Tyrael"], winner=0, length=1700, lead=0),
    ]
    s = game_shape(games, X)
    assert s["with"]["games"] == 2 and s["without"]["games"] == 2
    assert s["with"]["length_min"] == pytest.approx(1000 / 60)
    assert s["without"]["length_min"] == pytest.approx(1600 / 60)
    # its team's level lead at 10 minutes, on average
    assert s["with"]["lead_at_10"] == pytest.approx(1.5)
    # its team's record by game length
    assert s["with"]["by_length"]["short"] == {"games": 1, "win_rate": 100.0}


def test_answered_by_finds_what_the_other_team_drafts_after_it_and_how_that_goes() -> None:
    # team 0 picks Xal'atath first; team 1 answers with Zeratul in two games of three
    g1 = game(1, a=[X, *FILL[:4]], b=[Z, *FILL[4:8]], winner=1)
    g2 = game(2, a=[X, *FILL[:4]], b=[Z, *FILL[4:8]], winner=0)
    g3 = game(3, a=[X, *FILL[:4]], b=FILL[4:9], winner=0)
    # baseline: Zeratul in one game of three others
    g4 = game(4, a=FILL[:5], b=[Z, *FILL[5:9]], winner=1)
    g5 = game(5, a=FILL[:5], b=FILL[4:9], winner=1)
    g6 = game(6, a=FILL[:5], b=FILL[4:9], winner=1)
    ans = {r["hero"]: r for r in answered_by([g1, g2, g3, g4, g5, g6], X, min_games=1)}
    z = ans[Z]
    assert z["games"] == 2 and z["share"] == pytest.approx(200 / 3)
    assert z["baseline_share"] == pytest.approx(100 / 3)  # how often it is picked elsewhere
    assert z["lift"] == pytest.approx(2.0)
    assert z["win_rate"] == pytest.approx(50.0)  # Zeratul's side won one of two


def test_build_split_shows_which_build_of_the_answer_wins_and_in_whose_hands() -> None:
    aa = ["ZAA1", "ZAA4", "ZAA7", "ZR", "ZAA13", "MasterWarpBlade", "Z20"]
    other = ["ZQ1", "ZQ4", "ZQ7", "ZR", "ZQ13", "SentencedToDeath", "Z20"]
    games = [
        game(1, a=[X, *FILL[:4]], b=[Z, *FILL[4:8]], winner=1, talents={Z: aa}, mmr=2600),
        game(2, a=[X, *FILL[:4]], b=[Z, *FILL[4:8]], winner=1, talents={Z: aa}, mmr=2600),
        game(3, a=[X, *FILL[:4]], b=[Z, *FILL[4:8]], winner=0, talents={Z: other}, mmr=1800),
        game(4, a=[X, *FILL[:4]], b=[Z, *FILL[4:8]], winner=0, talents={Z: other}, mmr=2600),
    ]
    s = build_split(games, X, Z, level=16)
    rows = {r["talent"]: r for r in s["talents"]}
    assert rows["MasterWarpBlade"] == {
        "talent": "MasterWarpBlade",
        "games": 2,
        "win_rate": 100.0,
        "high_mmr": {"games": 2, "win_rate": 100.0},
        "low_mmr": {"games": 0, "win_rate": None},
    }
    assert rows["SentencedToDeath"]["win_rate"] == 0.0
    assert s["games"] == 4 and s["win_rate"] == pytest.approx(50.0)


def test_win_loss_contrast_shows_what_differs_when_the_answer_wins() -> None:
    def g(gid: int, win: int, xd: int, zd: float) -> dict[str, Any]:
        return game(
            gid,
            a=[X, *FILL[:4]],
            b=[Z, *FILL[4:8]],
            winner=win,
            score={X: {"deaths": xd}, Z: {"teamfight_hero_damage": zd}},
        )

    c = win_loss_contrast([g(1, 1, 5, 20000), g(2, 1, 3, 30000), g(3, 0, 1, 10000)], X, Z)
    assert c["wins"] == 2 and c["losses"] == 1
    assert c["centre"]["deaths"] == {"when_won": 4.0, "when_lost": 1.0}
    assert c["answer"]["teamfight_hero_damage"] == {"when_won": 25000.0, "when_lost": 10000.0}


def test_a_week_is_the_games_played_monday_to_sunday_kst(tmp_path: Any) -> None:
    import gzip
    import json

    from collector.replay_insights import load_week

    day = tmp_path / "2026-10-07"
    day.mkdir()
    rows = [
        {"id": 1, "type": "sl", "date": "2026-10-04 14:59:00"},  # Sunday 23:59 KST: w40
        {"id": 2, "type": "sl", "date": "2026-10-04 15:00:00"},  # Monday 00:00 KST: w41
        {"id": 3, "type": "sl", "date": "2026-10-11 14:59:59"},  # Sunday 23:59 KST: w41
        {"id": 2, "type": "sl", "date": "2026-10-04 15:00:00"},  # the same game twice
    ]
    with gzip.open(day / "replays_sl.jsonl.gz", "wt", encoding="utf-8") as f:
        f.writelines(json.dumps(r) + "\n" for r in rows)
    with gzip.open(day / "replays_qm.jsonl.gz", "wt", encoding="utf-8") as f:
        f.write(json.dumps({"id": 9, "type": "qm", "date": "2026-10-06 00:00:00"}) + "\n")
    week = load_week(tmp_path, "2026-w41")
    assert [g["id"] for g in week["sl"]] == [2, 3]
    assert [g["id"] for g in week["qm"]] == [9]


def test_a_hotfix_splits_the_week_and_the_centres_own_build_is_read_per_level() -> None:
    from collector.replay_insights import split_by_build, talent_picks

    w = ["XW1", "XW4", "XW7", "XR", "XW13", "XW16", "XW20"]
    q = ["XQ1", "XQ4", "XQ7", "XR", "XQ13", "XQ16", "XQ20"]
    before = [
        {
            **game(i, a=[X, *FILL[:4]], b=FILL[4:9], winner=0, talents={X: w}),
            "version": "2.57.0.98304",
        }
        for i in (1, 2, 3)
    ]
    after = [
        {
            **game(4, a=[X, *FILL[:4]], b=FILL[4:9], winner=1, talents={X: q}),
            "version": "2.57.0.98348",
        },
        {
            **game(5, a=[X, *FILL[:4]], b=FILL[4:9], winner=0, talents={X: w}),
            "version": "2.57.0.98348",
        },
    ]
    old, new = split_by_build(before + after, "2.57.0.98348")
    assert [g["id"] for g in old] == [1, 2, 3] and [g["id"] for g in new] == [4, 5]
    picks = talent_picks(new, X)
    first = {t["talent"]: t for t in picks["1"]}
    assert first["XQ1"] == {"talent": "XQ1", "games": 1, "share": 50.0, "win_rate": 0.0}
    assert first["XW1"]["win_rate"] == 100.0
    assert talent_picks(old, X)["1"][0]["share"] == 100.0


def test_ban_rates_show_where_the_ban_slots_go() -> None:
    from collector.replay_insights import ban_rates

    g1 = game(1, a=FILL[:5], b=FILL[4:9], winner=0)
    g1["draft"][:4] = [["b", 0, X], ["b", 1, "Qhira"], ["b", 0, "Johanna"], ["b", 1, None]]
    g1["draft"].append(["b", 0, "Qhira"])  # a second-phase ban (not in the first four)
    g2 = game(2, a=FILL[:5], b=FILL[4:9], winner=0)
    g2["draft"][:4] = [["b", 0, "Qhira"], ["b", 1, X], ["b", 0, None], ["b", 1, None]]
    rows = {r["hero"]: r for r in ban_rates([g1, g2])}
    assert rows["Qhira"]["ban_rate"] == 100.0 and rows["Qhira"]["first_phase_rate"] == 100.0
    assert rows["Johanna"] == {"hero": "Johanna", "ban_rate": 50.0, "first_phase_rate": 50.0}
    assert list(rows)[0] in {X, "Qhira"}


def test_by_enemy_trait_compares_its_record_against_teams_with_more_and_less_of_a_stat() -> None:
    # 10/5 hotfix: Void Step is now stopped by Immobilize — does a rooting team beat her more?
    from collector.replay_insights import by_enemy_trait

    def g(gid: int, roots: float, xal_wins: bool) -> dict[str, Any]:
        return game(
            gid,
            a=[X, *FILL[:4]],
            b=FILL[4:9],
            winner=0 if xal_wins else 1,
            score={h: {"rooting_enemies": roots} for h in FILL[4:9]},
        )

    games = [g(1, 0, True), g(2, 0, True), g(3, 2, True), g(4, 10, False), g(5, 12, False)]
    r = by_enemy_trait(games, X, "rooting_enemies")
    assert r["cut"] == 10.0  # the opposing team's total, split at its median
    assert r["more"] == {"games": 3, "win_rate": pytest.approx(100 / 3)}
    assert r["less"] == {"games": 2, "win_rate": 100.0}


def test_a_stat_most_teams_lack_splits_into_some_and_none() -> None:
    from collector.replay_insights import by_enemy_trait

    def g(gid: int, roots: float, xal_wins: bool) -> dict[str, Any]:
        return game(
            gid,
            a=[X, *FILL[:4]],
            b=FILL[4:9],
            winner=0 if xal_wins else 1,
            score={"Johanna": {"rooting_enemies": roots}},
        )

    games = [g(1, 0, True), g(2, 0, True), g(3, 0, False), g(4, 30, False), g(5, 40, True)]
    # Johanna is not in b; put the rooter in b
    for x in games:
        for p in x["players"]:
            if p["team"] == 1 and p["hero"] == FILL[4]:
                p["score"]["rooting_enemies"] = 30 if x["id"] >= 4 else 0
    r = by_enemy_trait(games, X, "rooting_enemies")
    assert r["cut"] == 0
    assert r["more"] == {"games": 2, "win_rate": 50.0}  # teams with any
    assert r["less"]["games"] == 3  # teams with none


def test_the_build_a_hotfix_shipped_in_is_the_first_new_build_after_its_date() -> None:
    from collector.replay_insights import build_after

    games = [
        {"version": "2.57.0.98304", "date": "2026-10-05 10:00:00"},
        {"version": "2.57.0.98348", "date": "2026-10-05 18:30:00"},
        {"version": "2.57.0.98304", "date": "2026-10-05 19:00:00"},  # a late upload of the old one
        {"version": "2.57.0.98348", "date": "2026-10-06 02:00:00"},
    ]
    assert build_after(games, "2026-10-05") == "2.57.0.98348"
    assert build_after(games, "2026-10-07") is None

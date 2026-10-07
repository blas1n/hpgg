"""주간 메타 리포트 (owner 2026-10-05): one issue a week (Mon–Sun, KST), published by the
Monday dawn run and kept. Heroes Profile's numbers are cumulative over the patch, so a week's
own games are the difference of two daily records of the same patch; the week's win rates get
the party correction like every other number on the site."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from collector.weekly import (
    build_issue,
    build_weekly,
    history_entry,
    iso_week,
    week_monday,
)


def _snap(view: str, rows: dict[str, tuple[int, int, int]], matches: int) -> dict[str, Any]:
    """A corrected whole view as the collector has it (only what history reads)."""
    return {
        "patch": "2.57.0",
        "mode": view,
        "matches": matches,
        "rows": [
            {"hero": h, "map": "all", "games": g, "wins": w, "bans": b}
            for h, (g, w, b) in rows.items()
        ]
        + [{"hero": "Valla", "map": "Cursed Hollow", "games": 1, "wins": 1, "bans": 0}],
    }


def _solo(rows: dict[str, tuple[int, int]]) -> dict[str, Any]:
    return {
        "patch": "2.57.0",
        "rows": [{"hero": h, "map": "all", "games": g, "wins": w} for h, (g, w) in rows.items()],
    }


def _entry(day: str, scale: int, patch: str = "2.57.0") -> dict[str, Any]:
    """Cumulative counts that grow by `scale` a day: Xal wins 70 % of its new games, Valla 45 %."""
    snaps = {
        v: _snap(
            v,
            {
                "Xal'atath": (100 * scale, 70 * scale, 10 * scale),
                "Valla": (100 * scale, 45 * scale, 0),
            },
            200 * scale,
        )
        for v in ("qm", "sl")
    }
    solos = {
        v: _solo({"Xal'atath": (40 * scale, 26 * scale), "Valla": (40 * scale, 18 * scale)})
        for v in ("qm", "sl")
    }
    e = history_entry(
        day=day, collected_at=f"{day}T03:20:00Z", patch=patch, snapshots=snaps, solos=solos
    )
    return e


PREVIOUS = {
    v: {
        "patch": "2.55.17",
        "mode": v,
        "matches": 1000,
        "collected_at": "2026-09-28T03:20:00Z",
        "rows": [
            {"hero": "Valla", "map": "Sky Temple", "games": 50, "wins": 26},
            {
                "hero": "Valla",
                "map": "all",
                "games": 500,
                "wins": 260,
                "losses": 240,
                "bans": 0,
                "pick": 50.0,
                "popularity": 50.0,
                "win_rate": 52.0,
                "ban_rate": 0.0,
                "ci": None,
                "tier_win_rate": 52.0,
            },
        ],
    }
    for v in ("qm", "sl")
}


def test_weeks_are_monday_to_sunday() -> None:
    assert iso_week("2026-10-05") == "2026-w41"  # a Monday opens week 41
    assert iso_week("2026-10-04") == "2026-w40"
    assert str(week_monday("2026-w40")) == "2026-09-28"


def test_history_keeps_the_whole_views_counts_and_solo_counts_only() -> None:
    e = _entry("2026-10-03", 1)
    assert e["patch"] == "2.57.0" and e["day"] == "2026-10-03"
    assert e["views"]["qm"]["matches"] == 200
    assert e["views"]["qm"]["heroes"]["Xal'atath"] == [100, 70, 10]
    assert e["views"]["qm"]["solo"]["Valla"] == [40, 18]
    assert "Cursed Hollow" not in json.dumps(e)  # map rows are not kept


def test_a_week_is_the_difference_of_two_mondays_of_the_same_patch() -> None:
    history = {d: _entry(d, s) for d, s in (("2026-10-05", 5), ("2026-10-12", 12))}
    issue = build_issue(
        "2026-w41",
        history,
        previous=PREVIOUS,
        previous_patch="2.55.17",
        patch_started_at="2026-09-29",
    )
    assert issue is not None and issue["kind"] == "week"
    assert (issue["start"], issue["end"]) == ("2026-10-05", "2026-10-12")
    win = {r["hero"]: r for r in issue["views"]["qm"]["window"]["rows"]}
    assert win["Xal'atath"]["games"] == 700 and win["Xal'atath"]["wins"] == 490
    assert win["Xal'atath"]["win_rate"] == pytest.approx(70.0)
    assert issue["views"]["qm"]["window"]["matches"] == 1400
    assert win["Xal'atath"]["pick"] == pytest.approx(700 / 1400 * 100)
    # the party correction: every row of the window carries tier_win_rate
    assert (
        "tier_win_rate" in win["Valla"]
        and issue["views"]["qm"]["window"]["party"]["solo_games"] == 560
    )


def test_the_week_a_patch_started_counts_from_the_patch_start_against_the_previous_patch() -> None:
    # 2.57.0 started on Tuesday 09-29; the first record of it in this form is 10-02
    history = {
        d: _entry(d, s) for d, s in (("2026-10-02", 2), ("2026-10-03", 3), ("2026-10-05", 5))
    }
    issue = build_issue(
        "2026-w40",
        history,
        previous=PREVIOUS,
        previous_patch="2.55.17",
        patch_started_at="2026-09-29",
    )
    assert issue is not None and issue["kind"] == "patch_start"
    assert issue["end"] == "2026-10-05"
    win = {r["hero"]: r for r in issue["views"]["qm"]["window"]["rows"]}
    assert win["Xal'atath"]["games"] == 500  # everything of the patch up to the Monday
    assert issue["baseline"] == {"kind": "previous_patch", "patch": "2.55.17"}
    assert [r["hero"] for r in issue["views"]["qm"]["baseline"]["rows"]] == ["Valla"]
    # the report reads "all maps" only: the previous patch's per-map rows are not carried
    assert {r["map"] for r in issue["views"]["qm"]["baseline"]["rows"]} == {"all"}


def test_a_normal_week_compares_with_the_week_before() -> None:
    history = {
        d: _entry(d, s) for d, s in (("2026-10-05", 5), ("2026-10-12", 12), ("2026-10-19", 20))
    }
    issue = build_issue(
        "2026-w42",
        history,
        previous=PREVIOUS,
        previous_patch="2.55.17",
        patch_started_at="2026-09-29",
    )
    assert issue["baseline"] == {"kind": "week", "week": "2026-w41"}
    base = {r["hero"]: r for r in issue["views"]["qm"]["baseline"]["rows"]}
    assert base["Valla"]["games"] == 700


def test_a_day_is_the_games_played_that_day_between_two_dawn_records() -> None:
    # the 10/5 dawn record less the 10/4 one is what was played on 10/4: the week (9/28 – 10/4)
    # never shows a 10/5
    history = {
        d: _entry(d, s)
        for d, s in (("2026-10-02", 2), ("2026-10-03", 3), ("2026-10-04", 4), ("2026-10-05", 5))
    }
    issue = build_issue(
        "2026-w40",
        history,
        previous=PREVIOUS,
        previous_patch="2.55.17",
        patch_started_at="2026-09-29",
    )
    days = issue["daily"]["qm"]
    assert [d["day"] for d in days] == ["2026-10-02", "2026-10-03", "2026-10-04"]
    assert days[0]["heroes"]["Xal'atath"] == [100, 70]


def test_no_issue_without_the_closing_record_or_across_a_gap() -> None:
    history = {"2026-10-05": _entry("2026-10-05", 5)}
    assert (
        build_issue(
            "2026-w41",
            history,
            previous=PREVIOUS,
            previous_patch="2.55.17",
            patch_started_at="2026-09-29",
        )
        is None
    )
    # a week whose opening record is missing and whose patch began earlier cannot be measured
    history = {"2026-10-19": _entry("2026-10-19", 19)}
    assert (
        build_issue(
            "2026-w42",
            history,
            previous=PREVIOUS,
            previous_patch="2.55.17",
            patch_started_at="2026-09-29",
        )
        is None
    )


def test_a_record_of_another_patch_does_not_open_a_week() -> None:
    history = {
        "2026-10-05": _entry("2026-10-05", 5, patch="2.55.17"),
        "2026-10-12": _entry("2026-10-12", 12),
    }
    # the patch changed during the week (started 10-07): from the patch start
    issue = build_issue(
        "2026-w41",
        history,
        previous=PREVIOUS,
        previous_patch="2.55.17",
        patch_started_at="2026-10-07",
    )
    assert issue["kind"] == "patch_start"


def test_build_weekly_writes_each_issue_once_and_an_index(tmp_path: Path) -> None:
    data = tmp_path / "data"
    (data / "history").mkdir(parents=True)
    (data / "previous").mkdir()
    (data / "latest").mkdir()
    for d, s in (("2026-10-02", 2), ("2026-10-05", 5)):
        (data / "history" / f"{d}.json").write_text(json.dumps(_entry(d, s)))
    for v, snap in PREVIOUS.items():
        (data / "previous" / f"{v}.json").write_text(json.dumps(snap))
    (data / "latest" / "meta.json").write_text(
        json.dumps(
            {
                "current_patch": "2.57.0",
                "previous_patch": "2.55.17",
                "patch_started_at": "2026-09-29",
            }
        )
    )
    assert build_weekly(data) == ["2026-w40"]
    issue = json.loads((data / "weekly" / "2026-w40.json").read_text())
    assert issue["week"] == "2026-w40"
    index = json.loads((data / "weekly" / "index.json").read_text())
    assert index["issues"][0] == {
        "week": "2026-w40",
        "kind": "patch_start",
        "start": issue["start"],
        "end": "2026-10-05",
        "patch": "2.57.0",
    }
    # an issue is kept as it was: a later run does not rewrite it
    (data / "weekly" / "2026-w40.json").write_text(json.dumps({**issue, "kept": True}))
    assert build_weekly(data) == []
    assert json.loads((data / "weekly" / "2026-w40.json").read_text())["kept"] is True


def test_the_index_lists_issues_only_not_their_analysis_evidence_or_talents(
    tmp_path: Path,
) -> None:
    # 2026-10-06: data/weekly/2026-w40.analysis.json matched the issue glob and the dawn run
    # failed on its missing "start"
    data = tmp_path / "data"
    (data / "history").mkdir(parents=True)
    (data / "latest").mkdir()
    (data / "weekly").mkdir()
    (data / "history" / "2026-10-05.json").write_text(json.dumps(_entry("2026-10-05", 5)))
    (data / "latest" / "meta.json").write_text(json.dumps({"current_patch": "2.57.0"}))
    issue = {"week": "2026-w40", "kind": "patch_start", "start": "s", "end": "e", "patch": "p"}
    (data / "weekly" / "2026-w40.json").write_text(json.dumps(issue))
    for extra in ("analysis", "evidence", "talents"):
        (data / "weekly" / f"2026-w40.{extra}.json").write_text(json.dumps({"week": "2026-w40"}))
    build_weekly(data)
    index = json.loads((data / "weekly" / "index.json").read_text())
    assert [i["week"] for i in index["issues"]] == ["2026-w40"]


def test_records_of_two_count_windows_are_not_subtracted() -> None:
    """A settled balance hotfix restarts the count (owner 2026-10-07): the counts shrink that day,
    so a week whose records span two windows has no rank issue (the replay report still has it)."""
    history = {d: _entry(d, s) for d, s in (("2026-10-06", 6), ("2026-10-13", 13))}
    history["2026-10-13"]["window"] = "2.57.0.98348"
    issue = build_issue(
        "2026-w41",
        history,
        previous=PREVIOUS,
        previous_patch="2.55.17",
        patch_started_at="2026-09-29",
    )
    assert issue is None
    history["2026-10-06"]["window"] = "2.57.0.98348"
    same = build_issue(
        "2026-w41",
        history,
        previous=PREVIOUS,
        previous_patch="2.55.17",
        patch_started_at="2026-09-29",
    )
    assert same is not None and same["kind"] == "week"


def test_the_week_a_hotfix_window_began_counts_from_it_against_the_patch_before_it() -> None:
    """Like a patch's first week: the games since the hotfix (the closing record's count, which
    restarted with the window) against the whole patch up to the last record before it."""
    history = {
        "2026-10-05": _entry("2026-10-05", 5),
        "2026-10-07": _entry("2026-10-07", 7),
        "2026-10-08": _entry("2026-10-08", 1),  # the count restarted at the hotfix
        "2026-10-12": _entry("2026-10-12", 5),
    }
    for d in ("2026-10-08", "2026-10-12"):
        history[d]["window"] = "2.57.0.98348"
    issue = build_issue(
        "2026-w41",
        history,
        previous=PREVIOUS,
        previous_patch="2.55.17",
        patch_started_at="2026-09-29",
    )
    assert issue is not None
    assert issue["kind"] == "hotfix_start" and issue["start"] == "2026-10-08"
    assert issue["baseline"] == {
        "kind": "before_hotfix",
        "until": "2026-10-07",
        "build": "2.57.0.98348",
    }
    xal = next(r for r in issue["views"]["qm"]["window"]["rows"] if r["hero"] == "Xal'atath")
    assert xal["games"] == 500  # everything since the hotfix: the closing record as it stands
    base = next(r for r in issue["views"]["qm"]["baseline"]["rows"] if r["hero"] == "Xal'atath")
    assert base["games"] == 700  # the whole patch until the day before the window

"""주간 메타 리포트 (owner 2026-10-05): one issue a week, Monday to Sunday (KST), kept.

Heroes Profile's numbers are cumulative over the patch, so a week's own games are the difference
of two daily records of the same patch: `data/history/<KST day>.json` keeps, per whole view,
each hero's games, wins and bans and its solo games and wins (the party correction's input).
The week's rows get the same party correction as every number on the site (party.py).

- An issue closes on the Monday dawn record after its week (or the next one within two days).
- It opens on the Monday record of the same patch: a normal week, compared with the week before.
- In the week a patch started there is no such record: the issue counts everything of the new
  patch up to the closing record and compares it with the previous patch (data/previous/).
- An issue is written once; later runs never rewrite it (an archive, linked from posts).
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import structlog

from collector.party import apply_party_correction

log = structlog.get_logger(__name__)

VIEWS = ("qm", "sl")
# a missed dawn run (GitHub, HP) still closes or opens a week with the next day's record
SLACK_DAYS = 2


def iso_week(day: str) -> str:
    y, w, _ = date.fromisoformat(day).isocalendar()
    return f"{y}-w{w:02d}"


def week_monday(week: str) -> date:
    y, w = week.split("-w")
    return date.fromisocalendar(int(y), int(w), 1)


def history_entry(
    *,
    day: str,
    collected_at: str,
    patch: str,
    snapshots: dict[str, dict[str, Any]],
    solos: dict[str, dict[str, Any]],
    window: str | None = None,
) -> dict[str, Any]:
    """One day's record: per whole view, matches and each hero's [games, wins, bans] and solo
    [games, wins], cumulative over the patch (the "all maps" rows only)."""
    views: dict[str, Any] = {}
    for view, snap in snapshots.items():
        if view not in VIEWS:
            continue
        rows = [r for r in snap.get("rows", []) if r.get("map") == "all"]
        solo = [r for r in solos.get(view, {}).get("rows", []) if r.get("map") == "all"]
        views[view] = {
            "matches": int(snap.get("matches") or 0),
            "heroes": {
                r["hero"]: [int(r["games"]), int(r["wins"]), int(r.get("bans") or 0)] for r in rows
            },
            "solo": {r["hero"]: [int(r["games"]), int(r["wins"])] for r in solo},
        }
    return {
        "day": day,
        "collected_at": collected_at,
        "patch": patch,
        "window": window,
        "views": views,
    }


def write_history(data_dir: Path, entry: dict[str, Any]) -> Path:
    path = data_dir / "history" / f"{entry['day']}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entry, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path


_ANY = object()


def _first_day(
    history: dict[str, dict[str, Any]],
    frm: date,
    *,
    patch: str | None = None,
    window: Any = _ANY,
    before: str | None = None,
) -> str | None:
    for i in range(SLACK_DAYS + 1):
        d = (frm + timedelta(days=i)).isoformat()
        if (
            d in history
            and (patch is None or history[d]["patch"] == patch)
            # a settled balance hotfix restarts the count: records of two windows don't subtract
            and (window is _ANY or history[d].get("window") == window)
            and (before is None or d < before)
        ):
            return d
    return None


def _window(
    end: dict[str, Any], start: dict[str, Any] | None, view: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    """The week's snapshot and its solo twin: end − start (or end alone from the patch start)."""
    e, s = end["views"][view], (start["views"][view] if start else None)
    matches = e["matches"] - (s["matches"] if s else 0)
    rows = []
    for hero, (g, w, b) in e["heroes"].items():
        g0, w0, b0 = s["heroes"].get(hero, [0, 0, 0]) if s else [0, 0, 0]
        games, wins, bans = g - g0, w - w0, b - b0
        if games <= 0 and bans <= 0:
            continue
        rows.append(
            {
                "hero": hero,
                "map": "all",
                "wins": wins,
                "losses": games - wins,
                "games": games,
                "bans": bans,
                "pick": round(games / matches * 100, 4) if matches else 0.0,
                "popularity": round((games + bans) / matches * 100, 4) if matches else 0.0,
                "win_rate": round(wins / games * 100, 4) if games else 0.0,
                "ban_rate": round(bans / matches * 100, 4) if matches else 0.0,
                "ci": None,
            }
        )
    solo_rows = []
    for hero, (g, w) in e["solo"].items():
        g0, w0 = s["solo"].get(hero, [0, 0]) if s else [0, 0]
        if g - g0 > 0:
            solo_rows.append({"hero": hero, "map": "all", "games": g - g0, "wins": w - w0})
    snap = {
        "patch": end["patch"],
        "mode": view,
        "game_type": view,
        "league_tier": None,
        "region": None,
        "collected_at": end["collected_at"],
        "matches": matches,
        "rows": rows,
    }
    return snap, {"patch": end["patch"], "rows": solo_rows}


def _corrected(end: dict[str, Any], start: dict[str, Any] | None, view: str) -> dict[str, Any]:
    snap, solo = _window(end, start, view)
    return apply_party_correction(snap, solo)


def _daily(
    history: dict[str, dict[str, Any]], frm: date, end_day: str, patch: str, view: str
) -> list[dict[str, Any]]:
    """Each day with records of the patch at its dawn and the next dawn: the heroes' [games, wins]
    played that day. A record is taken at dawn (KST), so record D less record D-1 is day D-1."""
    out = []
    d = frm + timedelta(days=1)
    while d.isoformat() <= end_day:
        today, yesterday = (
            history.get(d.isoformat()),
            history.get((d - timedelta(days=1)).isoformat()),
        )
        if (
            today
            and yesterday
            and today["patch"] == patch == yesterday["patch"]
            and today.get("window") == yesterday.get("window")
            and view in today["views"]
            and view in yesterday["views"]
        ):
            t, y = today["views"][view]["heroes"], yesterday["views"][view]["heroes"]
            heroes = {
                h: [g - y.get(h, [0, 0, 0])[0], w - y.get(h, [0, 0, 0])[1]]
                for h, (g, w, _) in t.items()
            }
            out.append(
                {
                    "day": (d - timedelta(days=1)).isoformat(),
                    "heroes": {h: v for h, v in heroes.items() if v[0] > 0},
                }
            )
        d += timedelta(days=1)
    return out


def _window_start(history: dict[str, dict[str, Any]], patch: str, window: str) -> str | None:
    """The first record of a count window (a settled balance hotfix) in a patch."""
    days = [
        d
        for d in sorted(history)
        if history[d]["patch"] == patch and history[d].get("window") == window
    ]
    return days[0] if days else None


def build_issue(
    week: str,
    history: dict[str, dict[str, Any]],
    *,
    previous: dict[str, dict[str, Any]] | None,
    previous_patch: str | None,
    patch_started_at: str | None,
) -> dict[str, Any] | None:
    """The issue of `week`, or None while it cannot be measured (no closing record yet, or a
    gap in the records of a patch that began before the week)."""
    mon = week_monday(week)
    nxt = mon + timedelta(days=7)
    end_day = _first_day(history, nxt)
    if end_day is None:
        return None
    end = history[end_day]
    patch = end["patch"]
    window = end.get("window")
    start_day = _first_day(history, mon, patch=patch, window=window, before=end_day)
    if start_day is not None:
        kind = "week"
        start: dict[str, Any] | None = history[start_day]
        frm = date.fromisoformat(start_day)
    elif (
        window is None
        and patch_started_at
        and mon <= date.fromisoformat(patch_started_at[:10]) < nxt
    ):
        kind, start, start_day = "patch_start", None, patch_started_at[:10]
        frm = mon - timedelta(days=1)
    elif (
        window is not None
        and (w_day := _window_start(history, patch, window)) is not None
        and (mon <= date.fromisoformat(w_day) < nxt)
    ):
        # a settled balance hotfix restarted the count this week: like a patch's first week, the
        # games since it (the closing record as it stands) against the patch before it
        kind, start, start_day = "hotfix_start", None, w_day
        frm = date.fromisoformat(w_day)
    else:
        return None

    prev_start_day = (
        _first_day(history, mon - timedelta(days=7), patch=patch, window=window, before=start_day)
        if kind == "week"
        else None
    )
    views: dict[str, Any] = {}
    baseline: dict[str, Any] | None
    before = (
        max((d for d in history if d < start_day and history[d]["patch"] == patch), default=None)
        if kind == "hotfix_start"
        else None
    )
    if kind == "week" and prev_start_day is not None:
        baseline = {"kind": "week", "week": iso_week((mon - timedelta(days=7)).isoformat())}
    elif kind == "hotfix_start" and before is not None:
        baseline = {"kind": "before_hotfix", "until": before, "build": window}
    elif previous and previous_patch:
        baseline = {"kind": "previous_patch", "patch": previous_patch}
    else:
        baseline = None
    for view in VIEWS:
        if view not in end["views"] or (start and view not in start["views"]):
            continue
        base = None
        if baseline and baseline["kind"] == "week":
            base = _corrected(history[start_day], history[prev_start_day], view)  # type: ignore[index]
        elif baseline and baseline["kind"] == "before_hotfix":
            prior = history[baseline["until"]]
            base = _corrected(prior, None, view) if view in prior["views"] else None
        elif baseline and previous and view in previous:
            # the report reads "all maps" only (per-map rows were 90 % of the file)
            base = {
                **previous[view],
                "rows": [r for r in previous[view]["rows"] if r.get("map") == "all"],
            }
        views[view] = {"window": _corrected(end, start, view), "baseline": base}
    return {
        "week": week,
        "kind": kind,
        "start": start_day,
        "end": end_day,
        "patch": patch,
        "collected_at": end["collected_at"],
        "baseline": baseline,
        "views": views,
        "daily": {v: _daily(history, frm, end_day, patch, v) for v in views},
    }


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def build_weekly(data_dir: Path) -> list[str]:
    """Write every issue that can be measured and is not written yet, then the index (newest
    first). Returns the weeks written."""
    history = {
        p.stem: json.loads(p.read_text(encoding="utf-8"))
        for p in sorted((data_dir / "history").glob("*.json"))
    }
    if not history:
        return []
    meta = _load(data_dir / "latest" / "meta.json") or {}
    out_dir = data_dir / "weekly"
    out_dir.mkdir(parents=True, exist_ok=True)
    days = sorted(history)
    week, last = iso_week(days[0]), iso_week(days[-1])
    written = []
    while week < last:
        path = out_dir / f"{week}.json"
        if not path.exists():
            issue_patch = None
            end_day = _first_day(history, week_monday(week) + timedelta(days=7))
            if end_day:
                issue_patch = history[end_day]["patch"]
            # the previous-patch files are the right baseline only for the current patch
            previous = None
            if issue_patch and issue_patch == meta.get("current_patch"):
                previous = {
                    v: s for v in VIEWS if (s := _load(data_dir / "previous" / f"{v}.json"))
                }
            try:
                issue = build_issue(
                    week,
                    history,
                    previous=previous or None,
                    previous_patch=meta.get("previous_patch"),
                    patch_started_at=meta.get("patch_started_at")
                    if issue_patch == meta.get("current_patch")
                    else None,
                )
            except ValueError as e:  # a week without solo games has no corrected numbers
                log.warning("weekly.skipped", week=week, error=str(e))
                issue = None
            if issue:
                path.write_text(
                    json.dumps(issue, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
                )
                written.append(week)
                log.info(
                    "weekly.issue",
                    week=week,
                    kind=issue["kind"],
                    start=issue["start"],
                    end=issue["end"],
                )
        week = iso_week((week_monday(week) + timedelta(days=7)).isoformat())
    issues = []
    # an issue is <yyyy>-w<ww>.json; its analysis, evidence and talents sit beside it
    for p in sorted(out_dir.glob("20[0-9][0-9]-w[0-9][0-9].json"), reverse=True):
        i = json.loads(p.read_text(encoding="utf-8"))
        issues.append(
            {
                "week": i["week"],
                "kind": i["kind"],
                "start": i["start"],
                "end": i["end"],
                "patch": i["patch"],
            }
        )
    (out_dir / "index.json").write_text(
        json.dumps({"issues": issues}, ensure_ascii=False), encoding="utf-8"
    )
    return written

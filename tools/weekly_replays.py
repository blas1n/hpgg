"""The weekly report's analysis on games (collector/replay_insights.py) for one week.

usage: uv run python tools/weekly_replays.py 2026-w41 --snapshots <dir with day folders>
       [--centre "Xal'atath"] [--answers 4] [--out data/weekly/<week>.replays.json]

The day folders are the `snapshots` branch's `snapshots/<KST day>/` (each run's
replays_sl.jsonl.gz / replays_qm.jsonl.gz). The centre is the most present hero of the week's
Storm League games (ban + pick) unless given. For it: the draft profile, the shape of its games,
the heroes drafted into it, and for the most lifted answers their record by talent at each level
(Storm League and, apart, Quick Match: in-game only) and what differs when they win.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

from collector.replay_insights import (
    LEVELS,
    answered_by,
    ban_rates,
    build_after,
    build_split,
    by_enemy_trait,
    draft_profile,
    game_shape,
    load_week,
    split_by_build,
    talent_picks,
    win_loss_contrast,
)


def centre_of(games: list[dict[str, Any]]) -> str:
    seen: Counter[str] = Counter()
    for g in games:
        heroes = {d[2] for d in g.get("draft") or [] if d[2]}
        seen.update(heroes)
    return seen.most_common(1)[0][0]


# time_cc_enemy_heroes is always 0 in HP's replays (2026-10-06)
CONTROL = ("rooting_enemies", "stunning_enemies", "silencing_enemies")


def _phase(games: list[dict[str, Any]], c: str) -> dict[str, Any]:
    return {
        "games": len(games),
        "draft": draft_profile(games, c),
        "shape": game_shape(games, c),
        "talents": talent_picks(games, c),
        "bans": ban_rates(games)[:10] if games else [],
        # against teams with more or less crowd control (10/5 hotfix: Immobilize stops Void Step)
        "vs_control": {st: by_enemy_trait(games, c, st) for st in CONTROL},
    }


def _hotfix(sl: list[dict[str, Any]], c: str, build: str) -> dict[str, Any]:
    before, after = split_by_build(sl, build)
    return {"build": build, "before": _phase(before, c), "after": _phase(after, c)}


def official_hotfix_day(patchnotes: Path, week: str, hero: str) -> str | None:
    """The day of an official hotfix to `hero` inside the week (Blizzard's notes), if any."""
    from datetime import date, timedelta

    if not patchnotes.exists():
        return None
    y, w = week.split("-w")
    monday = date.fromisocalendar(int(y), int(w), 1)
    days = {(monday + timedelta(days=i)).isoformat() for i in range(-1, 7)}
    notes = json.loads(patchnotes.read_text(encoding="utf-8")).get("notes", [])
    hits = [
        h["date"]
        for n in notes
        for h in n.get("hotfixes") or []
        if h.get("date") in days and hero in (h.get("heroes") or {})
    ]
    return min(hits) if hits else None


def analyse(
    week: str, snapshots: Path, *, centre: str | None, answers: int, hotfix: str | None = None
) -> dict[str, Any]:
    games = load_week(snapshots, week)
    sl, qm = games["sl"], games["qm"]
    c = centre or centre_of(sl)
    if hotfix == "auto":
        day = official_hotfix_day(Path("data/patchnotes.json"), week, c)
        hotfix = build_after(sl, day) if day else None
    drafted = answered_by(sl, c)
    top = [r["hero"] for r in drafted[:answers]]
    return {
        "week": week,
        "games": {"sl": len(sl), "qm": len(qm)},
        "centre": c,
        "draft": draft_profile(sl, c),
        "shape": game_shape(sl, c),
        "answered_by": drafted,
        "bans": ban_rates(sl)[:12],
        "talents": talent_picks(sl, c),
        # a hotfix to the centre in the week: before and after it, apart
        "hotfix": _hotfix(sl, c, hotfix) if hotfix else None,
        "answers": {
            a: {
                "sl": {str(lv): build_split(sl, c, a, level=lv) for lv in LEVELS},
                "qm": {str(lv): build_split(qm, c, a, level=lv) for lv in LEVELS},
                "contrast_sl": win_loss_contrast(sl, c, a),
                "contrast_qm": win_loss_contrast(qm, c, a),
            }
            for a in top
        },
    }


def _pct(v: float | None) -> str:
    return "—" if v is None else f"{v:.1f}%"


def summary(r: dict[str, Any]) -> str:
    d, s = r["draft"], r["shape"]
    lines = [
        f"# {r['week']} · games: SL {r['games']['sl']}, QM {r['games']['qm']}",
        f"centre {r['centre']}",
        f"draft: ban {_pct(d['ban_rate'])} (first ban {_pct(d['first_ban_rate'])}), "
        f"pick {_pct(d['pick_rate'])} ({d['picked']} games, wr {_pct(d['win_rate'])}), "
        f"pick round {d['pick_round']}",
        f"with: {s['with']}",
        f"without: {s['without']}",
        "bans: " + ", ".join(f"{b['hero']} {b['ban_rate']:.0f}%" for b in r["bans"]),
        "answered by (lift):",
    ]
    for a in r["answered_by"][:12]:
        lines.append(
            f"  {a['hero']}: {a['games']}g share {_pct(a['share'])} vs base "
            f"{_pct(a['baseline_share'])} lift {a['lift'] or 0:.2f} wr {_pct(a['win_rate'])}"
        )
    if r.get("hotfix"):
        h = r["hotfix"]
        lines.append(f"== hotfix {h['build']}")
        for side in ("before", "after"):
            p = h[side]
            d2 = p["draft"]
            lines.append(
                f"  {side}: {p['games']}g ban {_pct(d2['ban_rate'])} pick {_pct(d2['pick_rate'])} "
                f"({d2['picked']}g wr {_pct(d2['win_rate'])})"
            )
            for lv, ts in p["talents"].items():
                lines.append(
                    f"    L{lv}: "
                    + "; ".join(
                        f"{t['talent']} {t['share']:.0f}% wr {_pct(t['win_rate'])}" for t in ts[:3]
                    )
                )
            lines.append(
                "    bans: " + ", ".join(f"{b['hero']} {b['ban_rate']:.0f}%" for b in p["bans"][:6])
            )
            for st, v in p["vs_control"].items():
                lines.append(
                    f"    vs {st}: more {v['more']['games']}g {_pct(v['more']['win_rate'])}, "
                    f"less {v['less']['games']}g {_pct(v['less']['win_rate'])} (cut {v['cut']})"
                )
    for a, x in r["answers"].items():
        lines.append(f"== {a} vs {r['centre']}")
        for kind in ("sl", "qm"):
            first = x[kind]["1"]
            lines.append(f"  {kind}: {first['games']}g wr {_pct(first['win_rate'])}")
            for lv, b in x[kind].items():
                cells = "; ".join(
                    f"{t['talent']} {t['games']}g {_pct(t['win_rate'])} "
                    f"(hi {t['high_mmr']['games']}g {_pct(t['high_mmr']['win_rate'])})"
                    for t in b["talents"][:4]
                )
                lines.append(f"    L{lv}: {cells}")
        for kind in ("contrast_sl", "contrast_qm"):
            k = x[kind]
            lines.append(f"  {kind}: {k['wins']}W {k['losses']}L length {k['length_min']}")
            lines.append(f"    centre {k['centre']}")
            lines.append(f"    answer {k['answer']}")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("week")
    ap.add_argument("--snapshots", required=True)
    ap.add_argument("--centre")
    ap.add_argument("--answers", type=int, default=4)
    ap.add_argument(
        "--hotfix",
        help="a build that changed the centre this week (e.g. 2.57.0.98348), or 'auto': the build "
        "of an official hotfix to the centre dated in the week (data/patchnotes.json)",
    )
    ap.add_argument("--out")
    args = ap.parse_args()
    r = analyse(
        args.week,
        Path(args.snapshots),
        centre=args.centre,
        answers=args.answers,
        hotfix=args.hotfix,
    )
    out = Path(args.out or f"data/weekly/{args.week}.replays.json")
    out.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
    print(summary(r))


if __name__ == "__main__":
    main()

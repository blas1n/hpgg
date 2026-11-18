"""tools/usage_report.py: how many people used hpgg.win, for the portfolio README (shutdown day).

Only totals leave the service: no BattleTag, no IP, no cache key, no e-mail.
"""

from __future__ import annotations

from typing import Any

from tools.usage_report import DB_QUERY, render_markdown, render_svg, summarize


def _day(day: str, n: int) -> dict[str, Any]:
    return {"day": day, "daily": n, "hourly": [0] * 24}


TOTAL = {
    "total": 60,
    "stats": [
        _day("2026-09-28", 10),
        _day("2026-09-29", 30),
        _day("2026-09-30", 0),
        _day("2026-10-06", 20),
    ],
}
HITS = {
    "hits": [
        {"path": "/ko/hots", "count": 30, "event": False},
        {"path": "/en/hots/tier", "count": 10, "event": False},
        {"path": "/ko/hots/heroes/abathur", "count": 15, "event": False},
        {"path": "vote/qm/x/up", "count": 5, "event": True},
    ]
}
LOCATIONS = {
    "stats": [
        {"id": "KR", "name": "South Korea", "count": 50},
        {"id": "JP", "name": "Japan", "count": 10},
    ]
}
SIZES = {
    "stats": [
        {"id": "phone", "count": 15},
        {"id": "tablet", "count": 5},
        {"id": "desktop", "count": 30},
        {"id": "desktophd", "count": 10},
    ]
}
DB = {
    "accounts": 15,
    "first_signup": "2026-10-30",
    "pool_users": 3,
    "comments": 1,
    "calls": {"players": 919, "player_match_history": 1093, "replay_data": 1960},
}


def _u() -> Any:
    return summarize(TOTAL, HITS, LOCATIONS, SIZES, DB, start="2026-09-28", end="2026-10-06")


def test_visits_peak_and_weeks() -> None:
    u = _u()
    assert u.visits == 60
    assert u.peak == ("2026-09-29", 30)
    assert u.days == 9
    assert u.weekly == [("2026-09-28", 40), ("2026-10-05", 20)]  # weeks start on Monday


def test_language_device_and_country_shares() -> None:
    u = _u()
    assert u.languages == {"ko": 45, "en": 10}  # events are not page views
    assert u.devices == {"phone": 15, "tablet": 5, "desktop": 40}
    assert u.countries[0] == ("South Korea", 50)


def test_service_numbers_are_totals_only() -> None:
    u = _u()
    assert (u.accounts, u.pool_users, u.comments) == (15, 3, 1)
    assert u.player_lookups == 919 and u.replay_lookups == 1960


def test_the_db_query_reads_no_identity_column() -> None:
    q = DB_QUERY.lower()
    for column in ("battletag", "bnet_id", "ip_hash", "nickname", "body", "key"):
        assert column not in q


def test_markdown_states_the_numbers_and_the_period() -> None:
    md = render_markdown(_u())
    assert "2026-09-28" in md and "2026-10-06" in md
    assert "60" in md and "15" in md and "919" in md
    assert "South Korea" in md
    assert "docs/usage/daily-visits.svg" in md


def test_svg_has_one_bar_per_day_and_follows_the_theme() -> None:
    svg = render_svg(_u())
    # every day of the period, zeros included
    assert svg.startswith("<svg") and svg.count("<rect") == 9
    assert "prefers-color-scheme: dark" in svg


def test_the_readme_section_goes_before_what_it_did_and_is_replaced_next_time() -> None:
    from tools.usage_report import MARK_END, MARK_START, update_readme

    readme = "# HPGG\n\nintro\n\n## What it did\n\n- tiers\n"
    once = update_readme(readme, f"{MARK_START}\nA\n{MARK_END}")
    assert once.index("A") < once.index("## What it did")
    twice = update_readme(once, f"{MARK_START}\nB\n{MARK_END}")
    assert "B" in twice and "\nA\n" not in twice and twice.count(MARK_START) == 1

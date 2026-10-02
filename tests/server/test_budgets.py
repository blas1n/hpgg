"""Daily budgets against the plan's weekly caps (Intermediate since 2026-10-02, measured from HP's
X-HP-Quota-Limit headers): each fits a week (× 7 + its floor) and uses most of it."""

from __future__ import annotations

import pytest

from server.config import Settings

# bucket: (weekly cap, daily budget field, floor field)
PLAN = {
    "player": (25_000, "daily_live_budget", "quota_floor"),
    "player_match_history": (500, "match_daily_budget", "match_quota_floor"),
    "player_mmr_history": (25_000, "mmr_history_daily_budget", "mmr_history_quota_floor"),
    "replay_data": (25_000, "replay_daily_budget", "replay_quota_floor"),
    "player_hero_all": (500, "hero_stats_daily_budget", "hero_stats_quota_floor"),
}


@pytest.mark.parametrize("bucket", sorted(PLAN))
def test_each_budget_fits_the_week_and_uses_the_plan(bucket: str) -> None:
    cap, budget_f, floor_f = PLAN[bucket]
    s = Settings(_env_file=None, hp_api_token="x")  # type: ignore[call-arg]
    week = getattr(s, budget_f) * 7 + getattr(s, floor_f)
    assert week <= cap, bucket
    assert week >= 0.9 * cap, f"{bucket}: {week} of {cap} — the budget is still the Basic plan's"

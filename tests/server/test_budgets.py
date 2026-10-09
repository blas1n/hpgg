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
}


def _shared(bucket: str, cap: int) -> int:
    """The server's share of a bucket another job also spends: the weekly report's replay sampler
    (collector/replay_sample.py) opens its games from replay_data every day (2026-10-06)."""
    if bucket != "replay_data":
        return cap
    from collector.config import Settings as CollectorSettings

    c = CollectorSettings(_env_file=None, hp_api_token="x")  # type: ignore[call-arg]
    return cap - (c.replay_sl_per_run + c.replay_qm_per_run) * 7


@pytest.mark.parametrize("bucket", sorted(PLAN))
def test_each_budget_fits_the_week_and_uses_the_plan(bucket: str) -> None:
    cap, budget_f, floor_f = PLAN[bucket]
    cap = _shared(bucket, cap)
    s = Settings(_env_file=None, hp_api_token="x")  # type: ignore[call-arg]
    week = getattr(s, budget_f) * 7 + getattr(s, floor_f)
    assert week <= cap, bucket
    assert week >= 0.9 * cap, f"{bucket}: {week} of {cap} — the budget is still the Basic plan's"


def test_a_cold_query_costs_at_most_six_asks() -> None:
    """HP charges each 202 poll (2026-10-08), so a job that never finishes spends 1 + wait / poll
    asks of a 500-a-week bucket; at 2 s / 20 s that was 11."""
    s = Settings(_env_file=None, hp_api_token="x")  # type: ignore[call-arg]
    assert 1 + int(s.hp_job_wait_seconds // s.hp_job_poll_seconds) <= 6

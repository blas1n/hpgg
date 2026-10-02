"""Settings for the HPGG API server (pydantic-settings; env or deploy/.env)."""

from __future__ import annotations

from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every path, limit and origin lives here."""

    hp_api_token: SecretStr
    hp_base_url: str = "https://www.heroesprofile.com/api/external/v1"
    request_timeout: float = 15.0

    # SQLite file; in the container it sits on the named volume mounted at /data.
    db_path: Path = Path("data/.tmp/hpgg-api.sqlite")

    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"
    # Exact origins allowed to call the API from a browser (JSON list in the env).
    cors_origins: list[str] = ["https://hpgg.win"]

    # Player search. /players is on the 25,000/week bucket (Intermediate since 2026-10-02; 10,000
    # on Basic). Weekly caps measured from HP's X-HP-Quota-Limit; tests/server/test_budgets.py.
    player_ttl_seconds: int = 6 * 3600
    # HP answers 404 for free; keep it short so someone who just uploaded sees their games soon.
    not_found_ttl_seconds: int = 600
    quota_floor: int = 200  # stop live calls when HP reports this many left in the week
    daily_live_budget: int = 3500  # ≈ (25,000 − floor) / 7, so one busy day cannot starve the week
    ip_requests_per_minute: int = 20

    # Match list (`server/players/matches.py`). Full stat lines come from /players/matches, the
    # small bucket (500/week on Intermediate): ≈ (500 − floor) / 7 a day. Past that, the MMR
    # history (25,000/week) gives the games without stat lines, cached shorter so a full list can
    # follow.
    match_ttl_seconds: int = 6 * 3600
    basic_match_ttl_seconds: int = 3600
    match_quota_floor: int = 10
    match_daily_budget: int = 70
    mmr_history_quota_floor: int = 200
    mmr_history_daily_budget: int = 3500
    # One game in full (`server/players/replays.py`): /replay/{id}, 25,000/week on Intermediate. A
    # game never changes, but it names ten players, so it is kept no longer than stale_max_seconds.
    replay_quota_floor: int = 50
    replay_daily_budget: int = 3500
    # Stats per hero (`server/players/heroes.py`): /players/heroes, bucket player_hero_all (25/week
    # on Basic, 500 on Intermediate) ≈ (500 − floor) / 7 a day; one call per player and mode.
    hero_stats_ttl_seconds: int = 6 * 3600
    hero_stats_quota_floor: int = 20
    hero_stats_daily_budget: int = 68
    # A cold /players/matches query answers 202 and is asked again (polls are not charged).
    hp_job_poll_seconds: float = 2.0
    hp_job_wait_seconds: float = 20.0

    # HP API terms §5: within 24 h of a player going private, their data must be gone from every
    # surface and cache. The privacy feed (own bucket, 10,080/week) is polled well inside that, and
    # no profile is served or kept longer than 24 h after HP last returned it, feed or no feed.
    privacy_poll_seconds: int = 3600
    stale_max_seconds: int = 24 * 3600

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

"""Settings for the hotsmeta collector (pydantic-settings, .env)."""

from __future__ import annotations

from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every I/O path and knob lives here, never hardcoded."""

    hp_api_token: SecretStr
    hp_base_url: str = "https://www.heroesprofile.com/api/external/v1"
    data_dir: Path = Path("data")
    tmp_dir: Path = Path("data/.tmp")
    snapshot_out_dir: Path = Path("data/.snapshot_out")
    poll_interval_default: float = 10.0
    poll_max_seconds: float = 900.0
    map_call_spacing_seconds: float = 60.0
    # the weekly report's Storm League average stats, about once a week (collector/averages.py)
    average_stats: bool = True
    # the weekly report's per-game records (collector/replay_sample.py, owner 2026-10-06)
    replay_sample: bool = True
    replay_sl_per_run: int = 1200
    replay_qm_per_run: int = 300
    replay_lookback_ids: int = 5000
    replay_minutes: float = 35.0
    replay_call_spacing_seconds: float = 1.05
    # /heroes/matchups without group_by_map allows 60 requests/minute (measured 2026-09-29)
    matchups_call_spacing_seconds: float = 2.0
    # a matchups round stops starting new calls after this long (cache misses poll); the rest
    # stay due and are collected by the next run
    matchups_budget_seconds: float = 1500.0
    request_timeout: float = 60.0
    # official patch notes kept on the hero pages (newest live/balance notes, #62)
    patchnotes_limit: int = 12
    log_level: str = "INFO"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

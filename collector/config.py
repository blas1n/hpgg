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
    # /heroes/matchups without group_by_map allows 60 requests/minute (measured 2026-09-29)
    matchups_call_spacing_seconds: float = 2.0
    # a matchups round stops starting new calls after this long (cache misses poll); the rest
    # stay due and are collected by the next run
    matchups_budget_seconds: float = 1500.0
    request_timeout: float = 60.0
    log_level: str = "INFO"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

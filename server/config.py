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

    # Player search. /players is on the 10,000/week bucket (Basic plan).
    player_ttl_seconds: int = 6 * 3600
    # HP answers 404 for free; keep it short so someone who just uploaded sees their games soon.
    not_found_ttl_seconds: int = 600
    quota_floor: int = 200  # stop live calls when HP reports this many left in the week
    daily_live_budget: int = 1300  # ≈ (10,000 − floor) / 7, so one busy day cannot starve the week
    ip_requests_per_minute: int = 20

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

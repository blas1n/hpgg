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

    # Player search. /players carries career totals: 500/week on Intermediate since HP cut it on
    # 2026-11-02 (it was 25,000; 25 on Basic). /players/lookup kept the big bucket but has no
    # totals. Weekly caps measured from HP's X-HP-Quota-Limit; tests/server/test_budgets.py.
    player_ttl_seconds: int = 6 * 3600
    # HP answers 404 for free; keep it short so someone who just uploaded sees their games soon.
    not_found_ttl_seconds: int = 600
    quota_floor: int = 20  # stop live calls when HP reports this many left in the week
    daily_live_budget: int = 68  # ≈ (500 − floor) / 7, so one busy day cannot starve the week
    ip_requests_per_minute: int = 20
    # 20 a minute alone is 28,800 a day: one address could spend the daily budget above in three
    # hours (security review 2026-10-02). A search is 3-4 requests, a game opened one more.
    ip_requests_per_day: int = 500

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
    # The season card (`server/players/season.py`): /players/heroes for the current season's Storm
    # League, bucket player_hero_all (500/week on Intermediate) ≈ (500 − floor) / 7 a day, one ask
    # per player, cached as long as the match list (match_ttl_seconds, owner 2026-10-14). The
    # season comes from /patches (1,000,000/week), asked once a day.
    season_quota_floor: int = 20
    season_daily_budget: int = 68
    season_list_ttl_seconds: int = 24 * 3600
    # One game in full (`server/players/replays.py`): /replay/{id}, 25,000/week on Intermediate. A
    # game never changes, but it names ten players, so it is kept no longer than stale_max_seconds.
    # The bucket is shared with the weekly report's sampler (collector/replay_sample.py, ~1,500 a
    # day, 2026-10-06): 2,000 a day here leaves both room. 팀운 (teamluck.py) spends from it too.
    replay_quota_floor: int = 50
    replay_daily_budget: int = 2000
    # A cold /players/matches or /players/heroes query answers 202 with a job id, and /jobs/{id} is
    # polled (`hp.follow_job`): not charged, unlike asking the query again (2026-10-08, 10-15).
    hp_job_poll_seconds: float = 5.0
    hp_job_wait_seconds: float = 25.0

    # Comments (`server/comments/`, owner 2026-10-05): anonymous; per address a few at a time and a
    # day's worth; hidden after reports from `comment_hide_reports` addresses.
    comment_posts_per_window: int = 3
    comment_window_seconds: int = 600
    comment_posts_per_day: int = 20
    comment_reports_per_day: int = 30
    comment_reads_per_minute: int = 60
    comment_hide_reports: int = 3
    # HMAC key for addresses; empty = one the server makes and keeps in the database
    comment_secret: SecretStr = SecretStr("")

    # HP API terms §5: within 24 h of a player going private, their data must be gone from every
    # surface and cache. The privacy feed (own bucket, 10,080/week) is polled well inside that, and
    # no profile is served or kept longer than 24 h after HP last returned it, feed or no feed.
    privacy_poll_seconds: int = 3600
    stale_max_seconds: int = 24 * 3600

    # Accounts (`server/accounts/`, #28, owner 2026-10-30): Battle.net sign-in for the members-only
    # hero-pool 밴픽. No client id = sign-in is off (503). The secret comes from the vault through
    # ~/Works/_infra/scripts/secrets-sync.sh into deploy/.env.
    bnet_client_id: str = ""
    bnet_client_secret: SecretStr = SecretStr("")
    bnet_oauth_base: str = "https://oauth.battle.net"
    bnet_redirect_uri: str = "https://api.hpgg.win/v1/auth/battlenet/callback"
    # where a finished sign-in sends the browser back: the site, never anything else
    site_url: str = "https://hpgg.win"
    session_ttl_seconds: int = 30 * 86_400
    # a member's hero pool (stage C): this season's Storm League heroes with this many games or more
    pool_min_games: int = 5
    oauth_state_ttl_seconds: int = 600

    # The owner's MCP (`server/mcp/`, docs/DESIGN-2026-11-11-owner-mcp.md): ChatGPT reads the
    # owner's Storm League games. HP's API terms §3 allow HP data on our own API for personal use
    # only, so tokens go to this one Battle.net account; empty = no MCP routes at all.
    mcp_owner_battletag: str = ""
    mcp_owner_region: str = "KR"
    # the API's public origin: OAuth issuer, and the MCP resource is `<api_url>/mcp`
    api_url: str = "https://api.hpgg.win"
    mcp_allowed_hosts: list[str] = ["api.hpgg.win"]
    # dynamic client registration accepts only these redirect URIs (exact, or prefix for "…/")
    mcp_redirect_uris: list[str] = [
        "https://chatgpt.com/connector_platform_oauth_redirect",
        "https://chatgpt.com/connector/oauth/",
    ]
    mcp_access_ttl_seconds: int = 3600
    mcp_refresh_ttl_seconds: int = 30 * 86_400
    mcp_code_ttl_seconds: int = 300
    # a tool call refreshes the owner's games when the last refresh is older than this; it waits
    # up to mcp_sync_wait_seconds for it, then answers with what is stored
    mcp_sync_interval_seconds: int = 1800
    mcp_sync_wait_seconds: float = 10.0
    mcp_list_pages_max: int = 10
    # HP allows 60 calls a minute: replay details are fetched one at a time this far apart
    mcp_replay_interval_seconds: float = 1.1
    mcp_replays_per_sync: int = 400
    # the repo's data/ (latest/, heroes_ko.json, maps_ko.json); mounted read-only in the container
    site_data_dir: Path = Path("data")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

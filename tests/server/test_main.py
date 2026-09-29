"""Entrypoint and settings: migrate, JSON logs, uvicorn with our logging (no default config)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import pytest
import structlog
from fastapi import FastAPI

from server import __main__ as entry
from server.config import Settings
from server.logs import configure_logging
from tests.server.conftest import TOKEN


def test_settings_from_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HP_API_TOKEN", TOKEN)
    monkeypatch.setenv("DB_PATH", str(tmp_path / "a.sqlite"))
    monkeypatch.setenv("CORS_ORIGINS", '["https://hpgg.win"]')
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.hp_api_token.get_secret_value() == TOKEN
    assert s.cors_origins == ["https://hpgg.win"]
    assert s.hp_base_url == "https://www.heroesprofile.com/api/external/v1"
    assert TOKEN not in repr(s) and TOKEN not in str(s.model_dump())


def test_logs_are_json_including_foreign_loggers(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO")
    structlog.get_logger("t").info("hello", n=1)
    logging.getLogger("uvicorn.error").info("Started server process")
    logging.getLogger("t").debug("hidden")
    lines = [json.loads(x) for x in capsys.readouterr().err.strip().splitlines()]
    assert lines[0]["event"] == "hello" and lines[0]["n"] == 1 and lines[0]["level"] == "info"
    assert "timestamp" in lines[0]
    assert lines[1]["event"] == "Started server process"
    assert len(lines) == 2
    assert logging.getLogger("httpx").level == logging.WARNING


def test_main_runs_uvicorn_with_our_logging(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("HP_API_TOKEN", TOKEN)
    monkeypatch.setenv("DB_PATH", str(tmp_path / "m.sqlite"))
    monkeypatch.setenv("PORT", "8123")
    seen: dict[str, Any] = {}

    def fake_run(app: Any, **kw: Any) -> None:
        seen["app"] = app
        seen.update(kw)

    monkeypatch.setattr(entry.uvicorn, "run", fake_run)
    assert entry.main() == 0
    assert isinstance(seen["app"], FastAPI)
    assert seen["port"] == 8123 and seen["host"] == "0.0.0.0"
    assert seen["log_config"] is None and seen["access_log"] is False
    assert seen["proxy_headers"] is False

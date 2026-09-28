from __future__ import annotations

from pathlib import Path

from collector.config import Settings


def test_settings_reads_token_from_env_and_hides_it(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HP_API_TOKEN", "tok-123")
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "d"))
    s = Settings(_env_file=None)
    assert s.hp_api_token.get_secret_value() == "tok-123"
    assert "tok-123" not in repr(s)
    assert "tok-123" not in str(s)
    assert s.data_dir == tmp_path / "d"


def test_settings_defaults_point_at_v1(monkeypatch) -> None:
    monkeypatch.setenv("HP_API_TOKEN", "x")
    s = Settings(_env_file=None)
    assert s.hp_base_url == "https://www.heroesprofile.com/api/external/v1"
    assert s.map_call_spacing_seconds == 60
    assert s.poll_max_seconds == 900

"""The schema comes from Alembic migrations, and they must match the ORM models exactly."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine

from server.db import Base, migrate, sqlite_url


def test_migrate_creates_every_table_from_an_empty_file(tmp_path: Path) -> None:
    db = tmp_path / "sub" / "fresh.sqlite"
    migrate(db)
    rows = sqlite3.connect(db).execute("select name from sqlite_master where type='table'")
    names = {r[0] for r in rows}
    assert {"alembic_version", "hp_cache", "hp_quota", "hp_daily_usage"} <= names


def test_migrate_is_idempotent(tmp_path: Path) -> None:
    db = tmp_path / "x.sqlite"
    migrate(db)
    migrate(db)


def test_migrations_match_the_models(tmp_path: Path) -> None:
    db = tmp_path / "cmp.sqlite"
    migrate(db)
    engine = create_engine(sqlite_url(db, driver="pysqlite"))
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    engine.dispose()
    assert diff == []


async def test_connections_use_wal_and_a_busy_timeout(tmp_path: Path) -> None:
    from sqlalchemy import text

    from server.db import Database

    path = tmp_path / "w.sqlite"
    migrate(path)
    db = Database(path)
    async with db.session() as s:
        assert (await s.execute(text("PRAGMA journal_mode"))).scalar() == "wal"
        assert (await s.execute(text("PRAGMA busy_timeout"))).scalar() == 5000
    await db.dispose()

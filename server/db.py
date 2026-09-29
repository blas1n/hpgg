"""Persistence: one SQLite file (WAL), SQLAlchemy async sessions, schema owned by Alembic.

Every feature module (players now; accounts and community later) declares its tables on `Base`
and adds an Alembic revision under `server/migrations/versions/`.
"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

MIGRATIONS = Path(__file__).parent / "migrations"


class Base(DeclarativeBase):
    pass


def sqlite_url(path: Path, *, driver: str = "aiosqlite") -> str:
    return f"sqlite+{driver}:///{path}"


def migrate(path: Path) -> None:
    """`alembic upgrade head` on the database file (created if missing). Synchronous."""
    path.parent.mkdir(parents=True, exist_ok=True)
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", sqlite_url(path, driver="pysqlite"))
    command.upgrade(cfg, "head")


class Database:
    """The async engine and session factory, one per process."""

    def __init__(self, path: Path) -> None:
        self.engine: AsyncEngine = create_async_engine(sqlite_url(path))
        event.listen(self.engine.sync_engine, "connect", _sqlite_pragmas)
        self.session = async_sessionmaker(self.engine, expire_on_commit=False)

    async def dispose(self) -> None:
        await self.engine.dispose()


def _sqlite_pragmas(dbapi_conn: object, _record: object) -> None:
    cur = dbapi_conn.cursor()  # type: ignore[attr-defined]
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA busy_timeout=5000")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()

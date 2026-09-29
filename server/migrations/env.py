"""Alembic environment: synchronous SQLite (pysqlite), URL set by `server.db.migrate`.

No `fileConfig` here — the server configures logging itself (JSON).
New revision: `uv run alembic -c server/alembic.ini revision --autogenerate -m "..."`.
"""

from alembic import context
from sqlalchemy import engine_from_config, pool

from server.models import Base

config = context.config
target_metadata = Base.metadata


def run_migrations_online() -> None:
    engine = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata, render_as_batch=True
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run_migrations_online()

"""Alembic environment — async, driven by KATHA_DB_URL.

Reuses the app's declarative metadata (katha_infra.models.Base) as the
autogenerate target, so `alembic revision --autogenerate` diffs migrations
against the real models. Managed deployments run `alembic upgrade head` at
release time with KATHA_DB_AUTOCREATE=0, so the app never races the schema.
"""
from __future__ import annotations

import asyncio
import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

# Make the backend packages importable when alembic runs from backend/ (infra
# pulls in the ledger + domain packages, so all three go on the path).
_pkgs = Path(__file__).resolve().parents[1] / "packages"
for _name in ("infra", "ledger", "domain"):
    sys.path.insert(0, str(_pkgs / _name))
from katha_infra.models import Base  # noqa: E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    return os.environ.get(
        "KATHA_DB_URL", "postgresql+asyncpg://katha:katha@localhost:5432/katha")


def do_run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata,
                      compare_type=True, compare_server_default=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_online() -> None:
    engine = create_async_engine(get_url(), future=True)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


def run_offline() -> None:
    context.configure(url=get_url(), target_metadata=target_metadata,
                      literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_offline()
else:
    asyncio.run(run_online())

"""Async SQLAlchemy 2.0 engine/session wiring (aiosqlite for the dev slice).

The core-api routers are synchronous, so this module also exposes a tiny
`AsyncRunner` that owns one background event loop; the persistence adapter
submits coroutines to it and blocks for the result. That keeps a single
long-lived aiosqlite connection pool bound to one loop (creating a fresh loop
per call would break the async engine's pooling).
"""
from __future__ import annotations

import asyncio
import os
import threading
from typing import Awaitable, TypeVar

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .models import Base

T = TypeVar("T")

DEFAULT_DB_URL = "sqlite+aiosqlite:///./katha_dev.db"


def db_url() -> str:
    return os.environ.get("KATHA_DB_URL", DEFAULT_DB_URL)


class AsyncRunner:
    """Runs coroutines on a dedicated daemon event loop, blocking for the result."""

    def __init__(self) -> None:
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._loop.run_forever, name="katha-db-loop", daemon=True
        )
        self._thread.start()

    def run(self, coro: Awaitable[T]) -> T:
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result()

    def close(self) -> None:
        self._loop.call_soon_threadsafe(self._loop.stop)


class Database:
    """Owns the async engine + session factory and its runner loop."""

    def __init__(self, url: str | None = None) -> None:
        self.url = url or db_url()
        self.runner = AsyncRunner()
        self.engine: AsyncEngine = self.runner.run(self._make_engine())
        self.session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
            self.engine, expire_on_commit=False
        )
        self.runner.run(self._create_all())

    async def _make_engine(self) -> AsyncEngine:
        # SQLite (dev/test) keeps the default single-connection pool. A server
        # engine (Postgres) gets a real pool with pre-ping and recycling so it
        # survives idle drops and concurrent load — sized from env for QA/prod.
        if self.url.startswith("sqlite"):
            return create_async_engine(self.url, future=True)
        return create_async_engine(
            self.url, future=True,
            pool_size=int(os.environ.get("KATHA_DB_POOL_SIZE", "10")),
            max_overflow=int(os.environ.get("KATHA_DB_MAX_OVERFLOW", "10")),
            pool_pre_ping=True,
            pool_recycle=int(os.environ.get("KATHA_DB_POOL_RECYCLE", "1800")),
        )

    async def _create_all(self) -> None:
        # In managed deployments Alembic owns the schema; set KATHA_DB_AUTOCREATE=0
        # so the app never races migrations. Default on for dev/test (SQLite).
        if os.environ.get("KATHA_DB_AUTOCREATE", "1") == "0":
            return
        await self._create_all_unmanaged()

    async def _create_all_unmanaged(self) -> None:
        # checkfirst=True, but two services can still race on a fresh shared DB —
        # tolerate "table already exists" from a concurrent creator. Postgres
        # raises ProgrammingError here, SQLite OperationalError.
        from sqlalchemy.exc import OperationalError, ProgrammingError
        try:
            async with self.engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        except (OperationalError, ProgrammingError) as e:
            if "already exists" not in str(e):
                raise
        # Additive column migration for pre-existing dev DBs (create_all never
        # alters tables): ignore "duplicate column" on already-migrated DBs.
        from sqlalchemy import text
        for ddl in ("ALTER TABLE user_profile ADD COLUMN last_seen VARCHAR NOT NULL DEFAULT ''",
                    "ALTER TABLE user_profile ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0"):
            try:
                async with self.engine.begin() as conn:
                    await conn.execute(text(ddl))
            except (OperationalError, ProgrammingError):
                pass

    def run(self, coro: Awaitable[T]) -> T:
        return self.runner.run(coro)

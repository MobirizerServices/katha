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
        return create_async_engine(self.url, future=True)

    async def _create_all(self) -> None:
        # checkfirst=True, but two services can still race on a fresh shared DB —
        # tolerate "table already exists" from a concurrent creator.
        from sqlalchemy.exc import OperationalError
        try:
            async with self.engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        except OperationalError as e:
            if "already exists" not in str(e):
                raise
        # Additive column migration for pre-existing dev DBs (create_all never
        # alters tables): ignore "duplicate column" on already-migrated files.
        from sqlalchemy import text
        for ddl in ("ALTER TABLE user_profile ADD COLUMN last_seen VARCHAR NOT NULL DEFAULT ''",):
            try:
                async with self.engine.begin() as conn:
                    await conn.execute(text(ddl))
            except OperationalError:
                pass

    def run(self, coro: Awaitable[T]) -> T:
        return self.runner.run(coro)

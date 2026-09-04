"""A drop-in for `katha_ledger.Ledger` that also persists — atomically.

It owns a pure `Ledger` (rebuilt from the DB on construction) and treats it as
a process-local CACHE of the database, never as the arbiter. Every mutation
runs inside ONE database transaction that:

  1. takes the money-write lock (SQLite: `BEGIN IMMEDIATE`, Postgres: a
     transaction-scoped advisory lock), so writers in every worker and every
     service are serialized;
  2. folds in rows other processes committed since we last looked (an
     incremental read above our high-water mark, not a table scan);
  3. applies the pure ledger rule against that now-current state;
  4. writes the appended tail and the wallet projection, and commits.

If anything fails between 3 and the commit, the in-memory application is
rolled back and the error propagates: the cache never holds money the
database does not. A balance check therefore always runs against the latest
committed state, and two concurrent debits can no longer both pass.

The routers use exactly the same method surface as the pure ledger, so
swapping `store.ledger` from `Ledger()` to `PersistentLedger(...)` is the only
wiring change — the money rules stay in the pure ledger.
"""
from __future__ import annotations

import threading
from typing import Any, Callable

from sqlalchemy import func, insert, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from katha_ledger import Entitlement, Ledger, Transaction, TxType, UnlockResult, Wallet

from .db import Database
from .models import CoinTransactionRow, EntitlementRow, WalletRow
from .repository import LedgerRepository, _seq_of

_TX = CoinTransactionRow.__table__
_ENT = EntitlementRow.__table__
_WALLET = WalletRow.__table__

# One advisory key for every money write on Postgres. Global (not per-user)
# because transaction ids are minted from an in-memory sequence that must be
# current at mint time; a per-user lock would let two workers mint the same id
# for different users. Transactions here are a handful of statements, so this
# still clears hundreds of writes a second — a DB-side sequence for ids is the
# follow-up that would relax it.
_PG_LOCK_KEY = 0x4B41544841  # "KATHA"


def _tx_id_mark(seq: int) -> str:
    # ids are "ctx_%012d", so string order == numeric order on both engines.
    return f"ctx_{seq:012d}"


class PersistentLedger:
    def __init__(self, db: Database | None = None) -> None:
        self._db = db or Database()
        self._repo = LedgerRepository(self._db)
        self._inner = self._repo.load()
        self._ent_mark = self._db.run(self._max_ent_id())
        # Serializes in-process callers (sync routers run in a threadpool) so at
        # most one thread per process holds the DB lock and mutates the cache.
        self._lock = threading.RLock()

    # ---- reads (delegate to the cache) -----------------------------------
    def balance(self, user_id: str) -> Wallet:
        return self._inner.balance(user_id)

    def is_entitled(self, user_id: str, episode_id: str) -> bool:
        return self._inner.is_entitled(user_id, episode_id)

    def entitlements(self, user_id: str):
        return self._inner.entitlements(user_id)

    def transactions(self, user_id: str) -> list[Transaction]:
        return self._inner.transactions(user_id)

    def reconcile(self, user_id: str) -> Wallet:
        return self._inner.reconcile(user_id)

    # ---- cross-service freshness ----------------------------------------
    def refresh(self) -> int:
        """Fold in rows another process committed since we last looked.

        Read path only (no lock held in the DB): wallet/playback reads call
        this so an admin adjustment is visible without a restart. Mutations
        fold under the write lock themselves. Returns how many rows came in.
        """
        with self._lock:
            return self._db.run(self._refresh())

    async def _refresh(self) -> int:
        async with self._db.engine.connect() as conn:
            return await self._fold(conn)

    async def _max_ent_id(self) -> int:
        async with self._db.engine.connect() as conn:
            return (await conn.scalar(select(func.max(_ENT.c.id)))) or 0

    async def _fold(self, conn: AsyncConnection) -> int:
        """Apply rows above our high-water marks to the cache. Idempotency keys
        are globally unique, so a key we already hold is never re-applied even
        if a mark is somehow behind."""
        inner = self._inner
        tx_rows = (await conn.execute(
            select(_TX).where(_TX.c.id > _tx_id_mark(inner._seq)).order_by(_TX.c.id)
        )).all()
        ent_rows = (await conn.execute(
            select(_ENT).where(_ENT.c.id > self._ent_mark).order_by(_ENT.c.id)
        )).all()
        folded = 0
        for r in tx_rows:
            if r.idempotency_key in inner._by_key:
                continue
            tx = Transaction(
                id=r.id, user_id=r.user_id, type=TxType(r.type),
                amount_bought=r.amount_bought, amount_bonus=r.amount_bonus,
                reference_type=r.reference_type, reference_id=r.reference_id,
                idempotency_key=r.idempotency_key, created_at=r.created_at,
            )
            inner._log.append(tx)
            inner._by_key[tx.idempotency_key] = tx
            inner._wallet(tx.user_id).apply(tx)
            folded += 1
        if tx_rows:
            inner._seq = max(inner._seq, max(_seq_of(r.id) for r in tx_rows))
        for e in ent_rows:
            key = (e.user_id, e.episode_id)
            if key not in inner._entitlements:
                inner._entitlements[key] = Entitlement(
                    user_id=e.user_id, episode_id=e.episode_id,
                    source=e.source, created_at=e.created_at,
                )
            self._ent_mark = max(self._ent_mark, e.id)
        return folded

    # ---- the atomic mutation --------------------------------------------
    def _mutate(self, user_id: str, op: Callable[[Ledger], Any]) -> Any:
        with self._lock:
            try:
                return self._db.run(self._mutate_async(user_id, op))
            except IntegrityError:
                # A row committed by another process between our last fold and
                # this write collided on id or idempotency key. The failed
                # attempt was rolled back (DB and cache); fold again and retry
                # exactly once — under the lock the second attempt cannot race.
                return self._db.run(self._mutate_async(user_id, op))

    async def _begin_exclusive(self, conn: AsyncConnection) -> None:
        if self._db.url.startswith("sqlite"):
            # Reserve the write lock up front so concurrent writers (other
            # workers/services on the same file) queue here instead of failing
            # at commit; reads inside see the latest committed state.
            await conn.exec_driver_sql("BEGIN IMMEDIATE")
        else:
            await conn.execute(text("SELECT pg_advisory_xact_lock(:k)"),
                               {"k": _PG_LOCK_KEY})

    async def _mutate_async(self, user_id: str, op: Callable[[Ledger], Any]) -> Any:
        inner = self._inner
        async with self._db.engine.connect() as conn:
            await self._begin_exclusive(conn)
            await self._fold(conn)
            # Snapshot enough to undo the in-memory application. Every ledger
            # op touches exactly one user's wallet.
            log_mark, seq_mark = len(inner._log), inner._seq
            ents_before = set(inner._entitlements)
            wallet = inner._wallet(user_id)
            wallet_before = (wallet.balance_bought, wallet.balance_bonus)
            try:
                result = op(inner)
                new_tx = inner._log[log_mark:]
                new_ents = [e for k, e in inner._entitlements.items() if k not in ents_before]
                touched = {user_id} | {t.user_id for t in new_tx} | {e.user_id for e in new_ents}
                await self._write(conn, new_tx, new_ents, [inner._wallet(u) for u in touched])
                ent_mark = (await conn.scalar(select(func.max(_ENT.c.id)))) or 0
                await conn.commit()
            except BaseException:
                await conn.rollback()
                for tx in inner._log[log_mark:]:
                    inner._by_key.pop(tx.idempotency_key, None)
                del inner._log[log_mark:]
                inner._seq = seq_mark
                for k in [k for k in inner._entitlements if k not in ents_before]:
                    del inner._entitlements[k]
                wallet.balance_bought, wallet.balance_bonus = wallet_before
                raise
        self._ent_mark = max(self._ent_mark, ent_mark)
        return result

    async def _write(self, conn: AsyncConnection, transactions: list[Transaction],
                     entitlements: list[Entitlement], wallets: list[Wallet]) -> None:
        if transactions:
            await conn.execute(insert(_TX), [
                dict(id=t.id, user_id=t.user_id, type=t.type.value,
                     amount_bought=t.amount_bought, amount_bonus=t.amount_bonus,
                     reference_type=t.reference_type, reference_id=t.reference_id,
                     idempotency_key=t.idempotency_key, created_at=t.created_at)
                for t in transactions])
        if entitlements:
            await conn.execute(insert(_ENT), [
                dict(user_id=e.user_id, episode_id=e.episode_id,
                     source=e.source, created_at=e.created_at)
                for e in entitlements])
        for w in wallets:
            res = await conn.execute(
                update(_WALLET).where(_WALLET.c.user_id == w.user_id)
                .values(balance_bought=w.balance_bought, balance_bonus=w.balance_bonus))
            if res.rowcount == 0:
                await conn.execute(insert(_WALLET).values(
                    user_id=w.user_id, balance_bought=w.balance_bought,
                    balance_bonus=w.balance_bonus))

    # ---- mutations (same surface as the pure ledger) --------------------
    def credit(self, user_id: str, *args, **kwargs) -> Transaction:
        return self._mutate(user_id, lambda l: l.credit(user_id, *args, **kwargs))

    def unlock(self, user_id: str, *args, **kwargs) -> UnlockResult:
        return self._mutate(user_id, lambda l: l.unlock(user_id, *args, **kwargs))

    def grant_free(self, user_id: str, *args, **kwargs) -> Entitlement:
        return self._mutate(user_id, lambda l: l.grant_free(user_id, *args, **kwargs))

    def refund_clawback(self, user_id: str, *args, **kwargs) -> Transaction:
        return self._mutate(user_id, lambda l: l.refund_clawback(user_id, *args, **kwargs))

    def admin_adjust(self, user_id: str, *args, **kwargs) -> Transaction:
        return self._mutate(user_id, lambda l: l.admin_adjust(user_id, *args, **kwargs))

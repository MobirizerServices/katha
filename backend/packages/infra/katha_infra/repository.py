"""Persistence adapter for the pure coin ledger.

The ledger (`katha_ledger.Ledger`) stays pure and in-memory. This repository
rebuilds a Ledger from the persisted log at startup; per-mutation writes live in
`PersistentLedger`, which runs them inside one locked transaction. Because the
ledger is append-only, "append the tail" is all persistence needs — the DB and
the live projection can never disagree (and `Ledger.reconcile` proves it).
"""
from __future__ import annotations

from sqlalchemy import select

from katha_ledger import Entitlement, Ledger, Transaction, TxType

from .db import Database
from .models import CoinTransactionRow, EntitlementRow, WalletRow


def _seq_of(tx_id: str) -> int:
    # ids look like "ctx_000000000001"; fall back to 0 for anything unexpected.
    tail = tx_id.rsplit("_", 1)[-1]
    return int(tail) if tail.isdigit() else 0


class LedgerRepository:
    """Loads and persists a `Ledger` through an async SQLAlchemy `Database`."""

    def __init__(self, db: Database) -> None:
        self.db = db

    # ---- load (startup / restart) ---------------------------------------
    def load(self) -> Ledger:
        return self.db.run(self._load())

    async def _load(self) -> Ledger:
        ledger = Ledger()
        async with self.db.session_factory() as session:
            tx_rows = (
                await session.execute(select(CoinTransactionRow))
            ).scalars().all()
            ent_rows = (
                await session.execute(select(EntitlementRow))
            ).scalars().all()

        rebuilt: list[Transaction] = []
        for r in tx_rows:
            rebuilt.append(
                Transaction(
                    id=r.id,
                    user_id=r.user_id,
                    type=TxType(r.type),
                    amount_bought=r.amount_bought,
                    amount_bonus=r.amount_bonus,
                    reference_type=r.reference_type,
                    reference_id=r.reference_id,
                    idempotency_key=r.idempotency_key,
                    created_at=r.created_at,
                )
            )
        rebuilt.sort(key=lambda t: _seq_of(t.id))

        # Repopulate the ledger's internal state directly (trusted adapter).
        for tx in rebuilt:
            ledger._log.append(tx)
            ledger._by_key[tx.idempotency_key] = tx
            ledger._wallet(tx.user_id).apply(tx)
        ledger._seq = max((_seq_of(t.id) for t in rebuilt), default=0)

        for e in ent_rows:
            ledger._entitlements[(e.user_id, e.episode_id)] = Entitlement(
                user_id=e.user_id,
                episode_id=e.episode_id,
                source=e.source,
                created_at=e.created_at,
            )
        return ledger

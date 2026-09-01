"""A drop-in for `katha_ledger.Ledger` that also persists.

It owns a pure `Ledger` (rebuilt from the DB on construction) and, after every
mutating call, flushes the newly-appended tail to the `LedgerRepository`. Reads
delegate straight through. The routers use exactly the same method surface, so
swapping `store.ledger` from `Ledger()` to `PersistentLedger(...)` is the only
wiring change — the money rules stay in the pure ledger.
"""
from __future__ import annotations

from sqlalchemy import select

from katha_ledger import Entitlement, Ledger, Transaction, TxType, UnlockResult, Wallet

from .db import Database
from .models import CoinTransactionRow, EntitlementRow
from .repository import LedgerRepository, _seq_of


class PersistentLedger:
    def __init__(self, db: Database | None = None) -> None:
        self._db = db or Database()
        self._repo = LedgerRepository(self._db)
        self._inner = self._repo.load()
        self._persisted_tx = len(self._inner._log)
        self._persisted_ents: set[tuple[str, str]] = set(self._inner._entitlements)

    # ---- flush the append-only tail -------------------------------------
    def _flush(self, users: set[str]) -> None:
        new_tx: list[Transaction] = self._inner._log[self._persisted_tx:]
        new_ents: list[Entitlement] = [
            e for k, e in self._inner._entitlements.items()
            if k not in self._persisted_ents
        ]
        touched = users | {t.user_id for t in new_tx} | {e.user_id for e in new_ents}
        wallets: list[Wallet] = [self._inner._wallet(u) for u in touched]
        self._repo.persist(new_tx, new_ents, wallets)
        self._persisted_tx = len(self._inner._log)
        self._persisted_ents = set(self._inner._entitlements)

    # ---- reads (delegate) -----------------------------------------------
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
        """Fold in rows another service appended to the same DB.

        admin-api writes adjustments through its own PersistentLedger; without
        this, a long-lived core-api process neither sees them nor advances its
        id sequence past theirs (risking a primary-key collision on its next
        write). Idempotency keys are globally unique, so they identify foreign
        rows. Returns how many rows were folded in.
        """
        return self._db.run(self._refresh())

    async def _refresh(self) -> int:
        async with self._db.session_factory() as session:
            tx_rows = (await session.execute(select(CoinTransactionRow))).scalars().all()
            ent_rows = (await session.execute(select(EntitlementRow))).scalars().all()
        inner = self._inner
        fresh = [r for r in tx_rows if r.idempotency_key not in inner._by_key]
        fresh.sort(key=lambda r: _seq_of(r.id))
        for r in fresh:
            tx = Transaction(
                id=r.id, user_id=r.user_id, type=TxType(r.type),
                amount_bought=r.amount_bought, amount_bonus=r.amount_bonus,
                reference_type=r.reference_type, reference_id=r.reference_id,
                idempotency_key=r.idempotency_key, created_at=r.created_at,
            )
            inner._log.append(tx)
            inner._by_key[tx.idempotency_key] = tx
            inner._wallet(tx.user_id).apply(tx)
        inner._seq = max(inner._seq, max((_seq_of(r.id) for r in tx_rows), default=0))
        for e in ent_rows:
            key = (e.user_id, e.episode_id)
            if key not in inner._entitlements:
                inner._entitlements[key] = Entitlement(
                    user_id=e.user_id, episode_id=e.episode_id,
                    source=e.source, created_at=e.created_at,
                )
        # Everything in the log is now on disk; _flush must not re-write it.
        self._persisted_tx = len(inner._log)
        self._persisted_ents = set(inner._entitlements)
        return len(fresh)

    # ---- mutations (delegate, then flush) -------------------------------
    def credit(self, user_id: str, *args, **kwargs) -> Transaction:
        self.refresh()
        tx = self._inner.credit(user_id, *args, **kwargs)
        self._flush({user_id})
        return tx

    def unlock(self, user_id: str, *args, **kwargs) -> UnlockResult:
        self.refresh()
        res = self._inner.unlock(user_id, *args, **kwargs)
        self._flush({user_id})
        return res

    def grant_free(self, user_id: str, *args, **kwargs) -> Entitlement:
        self.refresh()
        ent = self._inner.grant_free(user_id, *args, **kwargs)
        self._flush({user_id})
        return ent

    def refund_clawback(self, user_id: str, *args, **kwargs) -> Transaction:
        self.refresh()
        tx = self._inner.refund_clawback(user_id, *args, **kwargs)
        self._flush({user_id})
        return tx

    def admin_adjust(self, user_id: str, *args, **kwargs) -> Transaction:
        self.refresh()
        tx = self._inner.admin_adjust(user_id, *args, **kwargs)
        self._flush({user_id})
        return tx

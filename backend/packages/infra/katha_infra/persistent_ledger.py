"""A drop-in for `katha_ledger.Ledger` that also persists.

It owns a pure `Ledger` (rebuilt from the DB on construction) and, after every
mutating call, flushes the newly-appended tail to the `LedgerRepository`. Reads
delegate straight through. The routers use exactly the same method surface, so
swapping `store.ledger` from `Ledger()` to `PersistentLedger(...)` is the only
wiring change — the money rules stay in the pure ledger.
"""
from __future__ import annotations

from katha_ledger import Entitlement, Ledger, Transaction, UnlockResult, Wallet

from .db import Database
from .repository import LedgerRepository


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

    def transactions(self, user_id: str) -> list[Transaction]:
        return self._inner.transactions(user_id)

    def reconcile(self, user_id: str) -> Wallet:
        return self._inner.reconcile(user_id)

    # ---- mutations (delegate, then flush) -------------------------------
    def credit(self, user_id: str, *args, **kwargs) -> Transaction:
        tx = self._inner.credit(user_id, *args, **kwargs)
        self._flush({user_id})
        return tx

    def unlock(self, user_id: str, *args, **kwargs) -> UnlockResult:
        res = self._inner.unlock(user_id, *args, **kwargs)
        self._flush({user_id})
        return res

    def grant_free(self, user_id: str, *args, **kwargs) -> Entitlement:
        ent = self._inner.grant_free(user_id, *args, **kwargs)
        self._flush({user_id})
        return ent

    def refund_clawback(self, user_id: str, *args, **kwargs) -> Transaction:
        tx = self._inner.refund_clawback(user_id, *args, **kwargs)
        self._flush({user_id})
        return tx

    def admin_adjust(self, user_id: str, *args, **kwargs) -> Transaction:
        tx = self._inner.admin_adjust(user_id, *args, **kwargs)
        self._flush({user_id})
        return tx

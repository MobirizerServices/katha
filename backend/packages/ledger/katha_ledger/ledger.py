"""The Katha coin ledger — pure, deterministic, heavily tested (PDD §12.7).

Guarantees:
  * Append-only: transactions are never mutated or deleted; corrections are new rows.
  * Idempotent: every mutating op carries an idempotency_key; a duplicate key returns
    the ORIGINAL result and appends nothing (protects against retried IAP/webhook calls).
  * Bonus-first spend: unlocks draw from the bonus pool before the bought pool.
  * Reconcilable: wallet balances are projections; replaying the log reproduces them exactly.
  * Refund safety: a refund clawback may drive a balance negative; unlocks are blocked
    while any pool is negative until settled.

This module has NO I/O and NO third-party dependencies. A persistence adapter
(SQLAlchemy repository) wraps it in services/core-api; the rules live here so they
are trivially testable and reusable by any client of the contracts.
"""
from __future__ import annotations

from .models import (
    CREDIT_TYPES,
    Entitlement,
    Transaction,
    TxType,
    UnlockResult,
    Wallet,
)


class LedgerError(Exception):
    pass


class InsufficientCoins(LedgerError):
    def __init__(self, needed: int, available: int):
        super().__init__(f"insufficient coins: need {needed}, have {available}")
        self.needed = needed
        self.available = available


class BalanceNegative(LedgerError):
    """Unlocks are blocked while a refund clawback has left a pool negative."""


class IdempotencyConflict(LedgerError):
    """The key was already used for a DIFFERENT operation (another user, type,
    reference, or amount). A replay must be byte-for-byte the same request;
    anything else is a client bug or an attempt to pre-empt someone else's key,
    and must never be answered with the original's result."""


class Ledger:
    def __init__(self) -> None:
        self._log: list[Transaction] = []
        self._by_key: dict[str, Transaction] = {}
        self._wallets: dict[str, Wallet] = {}
        self._entitlements: dict[tuple[str, str], Entitlement] = {}
        self._seq = 0

    # ---- internals -------------------------------------------------------
    def _next_id(self) -> str:
        self._seq += 1
        return f"ctx_{self._seq:012d}"

    def _wallet(self, user_id: str) -> Wallet:
        return self._wallets.setdefault(user_id, Wallet(user_id))

    @staticmethod
    def _same_operation(existing: Transaction, *, user_id: str, tx_type: TxType,
                        reference_type: str, reference_id: str,
                        amounts: tuple[int, int] | None = None) -> bool:
        if (existing.user_id, existing.type, existing.reference_type,
                existing.reference_id) != (user_id, tx_type, reference_type, reference_id):
            return False
        return amounts is None or amounts == (existing.amount_bought, existing.amount_bonus)

    def _append(self, tx: Transaction) -> Transaction:
        # Idempotency: a replayed key returns the original, appends nothing —
        # but only for the SAME operation; a different one under a used key
        # is a conflict, never a silent no-op wearing the original's result.
        existing = self._by_key.get(tx.idempotency_key)
        if existing is not None:
            if not self._same_operation(
                    existing, user_id=tx.user_id, tx_type=tx.type,
                    reference_type=tx.reference_type, reference_id=tx.reference_id,
                    amounts=(tx.amount_bought, tx.amount_bonus)):
                raise IdempotencyConflict(
                    f"idempotency key {tx.idempotency_key!r} already used for a different operation")
            return existing
        self._log.append(tx)
        self._by_key[tx.idempotency_key] = tx
        self._wallet(tx.user_id).apply(tx)
        return tx

    # ---- reads -----------------------------------------------------------
    def balance(self, user_id: str) -> Wallet:
        return self._wallet(user_id)

    def is_entitled(self, user_id: str, episode_id: str) -> bool:
        return (user_id, episode_id) in self._entitlements

    def entitlements(self, user_id: str) -> list[Entitlement]:
        return [e for (u, _), e in self._entitlements.items() if u == user_id]

    def transactions(self, user_id: str) -> list[Transaction]:
        return [t for t in self._log if t.user_id == user_id]

    # ---- credits ---------------------------------------------------------
    def credit(
        self,
        user_id: str,
        tx_type: TxType,
        *,
        coins: int,
        reference_type: str,
        reference_id: str,
        idempotency_key: str,
        created_at: str,
    ) -> Transaction:
        if tx_type not in CREDIT_TYPES:
            raise LedgerError(f"{tx_type} is not a credit type")
        if coins <= 0:
            raise LedgerError("credit amount must be positive")
        # PURCHASE credits the bought pool; everything else credits bonus.
        bought = coins if tx_type is TxType.PURCHASE else 0
        bonus = 0 if tx_type is TxType.PURCHASE else coins
        tx = Transaction(
            id=self._next_id(),
            user_id=user_id,
            type=tx_type,
            amount_bought=bought,
            amount_bonus=bonus,
            reference_type=reference_type,
            reference_id=reference_id,
            idempotency_key=idempotency_key,
            created_at=created_at,
        )
        return self._append(tx)

    # ---- unlock (debit + entitlement, atomic) ----------------------------
    def unlock(
        self,
        user_id: str,
        episode_ids: list[str],
        *,
        price_per_episode: int,
        reference_type: str,
        reference_id: str,
        idempotency_key: str,
        created_at: str,
        source: str = "unlock",
        total_cost: int | None = None,
    ) -> UnlockResult:
        """Unlock one or more episodes atomically. Bundle = many episodes, one debit.

        Skips episodes already entitled (idempotent at the episode level too), so a
        retried bundle unlock never double-charges. Bonus coins are spent first.

        `total_cost` charges an EXACT total for the set (used by bundle unlock-all so
        the charge equals the advertised discounted price, not a per-episode rounding).
        When omitted, cost = price_per_episode × episodes actually unlocked.
        """
        if idempotency_key in self._by_key:
            original = self._by_key[idempotency_key]
            # Amounts are state-dependent for an unlock, so a replay is judged
            # on who/what, not on how much was spent the first time.
            if not self._same_operation(original, user_id=user_id, tx_type=TxType.UNLOCK,
                                        reference_type=reference_type,
                                        reference_id=reference_id):
                raise IdempotencyConflict(
                    f"idempotency key {idempotency_key!r} already used for a different operation")
            ents = [self._entitlements[(user_id, e)] for e in episode_ids
                    if (user_id, e) in self._entitlements]
            return UnlockResult(transaction=original, entitlements=ents,
                                spent_bonus=-original.amount_bonus,
                                spent_bought=-original.amount_bought)

        wallet = self._wallet(user_id)
        if wallet.balance_bought < 0 or wallet.balance_bonus < 0:
            raise BalanceNegative("settle negative balance before unlocking")

        to_unlock = [e for e in episode_ids if (user_id, e) not in self._entitlements]
        if not to_unlock:
            cost = 0
        elif total_cost is not None:
            cost = total_cost
        else:
            cost = price_per_episode * len(to_unlock)
        if cost == 0:
            # Everything already owned — no-op, return existing entitlements.
            ents = [self._entitlements[(user_id, e)] for e in episode_ids]
            noop = Transaction(
                id=self._next_id(), user_id=user_id, type=TxType.UNLOCK,
                amount_bought=0, amount_bonus=0, reference_type=reference_type,
                reference_id=reference_id, idempotency_key=idempotency_key,
                created_at=created_at,
            )
            self._append(noop)
            return UnlockResult(transaction=noop, entitlements=ents)

        if wallet.total < cost:
            raise InsufficientCoins(cost, wallet.total)

        spend_bonus = min(wallet.balance_bonus, cost)
        spend_bought = cost - spend_bonus

        tx = Transaction(
            id=self._next_id(),
            user_id=user_id,
            type=TxType.UNLOCK,
            amount_bought=-spend_bought,
            amount_bonus=-spend_bonus,
            reference_type=reference_type,
            reference_id=reference_id,
            idempotency_key=idempotency_key,
            created_at=created_at,
        )
        self._append(tx)
        ents: list[Entitlement] = []
        for e in to_unlock:
            ent = Entitlement(user_id=user_id, episode_id=e, source=source, created_at=created_at)
            self._entitlements[(user_id, e)] = ent
            ents.append(ent)
        return UnlockResult(transaction=tx, entitlements=ents,
                            spent_bonus=spend_bonus, spent_bought=spend_bought)

    def grant_free(self, user_id: str, episode_id: str, *, created_at: str) -> Entitlement:
        ent = Entitlement(user_id=user_id, episode_id=episode_id, source="free", created_at=created_at)
        self._entitlements[(user_id, episode_id)] = ent
        return ent

    # ---- refund clawback -------------------------------------------------
    def refund_clawback(
        self,
        user_id: str,
        *,
        coins: int,
        reference_type: str,
        reference_id: str,
        idempotency_key: str,
        created_at: str,
    ) -> Transaction:
        """Reverse a purchase's coins (Apple/gateway refund). May go negative;
        unlocks are then blocked until the balance is settled (PDD §8.5)."""
        if coins <= 0:
            raise LedgerError("clawback amount must be positive")
        tx = Transaction(
            id=self._next_id(),
            user_id=user_id,
            type=TxType.REFUND_CLAWBACK,
            amount_bought=-coins,
            amount_bonus=0,
            reference_type=reference_type,
            reference_id=reference_id,
            idempotency_key=idempotency_key,
            created_at=created_at,
        )
        return self._append(tx)

    def admin_adjust(
        self,
        user_id: str,
        *,
        coins: int,
        reference_type: str,
        reference_id: str,
        idempotency_key: str,
        created_at: str,
    ) -> Transaction:
        """Signed manual adjustment (support goodwill / finance correction). Audited
        upstream; dual approval above 500 is enforced in admin-api, not here."""
        tx = Transaction(
            id=self._next_id(),
            user_id=user_id,
            type=TxType.ADMIN_ADJUST,
            amount_bought=coins,          # signed: may be + or -
            amount_bonus=0,
            reference_type=reference_type,
            reference_id=reference_id,
            idempotency_key=idempotency_key,
            created_at=created_at,
        )
        return self._append(tx)

    # ---- reconciliation --------------------------------------------------
    def reconcile(self, user_id: str) -> Wallet:
        """Recompute the wallet purely from the log (nightly job in production).
        Returns the rebuilt wallet; raises if it drifts from the live projection."""
        rebuilt = Wallet(user_id)
        for tx in self._log:
            if tx.user_id == user_id:
                rebuilt.apply(tx)
        live = self._wallet(user_id)
        if (rebuilt.balance_bought, rebuilt.balance_bonus) != (live.balance_bought, live.balance_bonus):
            raise LedgerError(
                f"ledger drift for {user_id}: rebuilt={rebuilt} live={live}"
            )
        return rebuilt

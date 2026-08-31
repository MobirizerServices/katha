"""Money primitives for the Katha coin ledger.

The ledger is the single source of truth (PDD §12.7). Every balance change is an
append-only transaction; wallet balances are projections that must always be
reconstructable from the transaction log. Bonus coins are spent before bought
coins. Coins never expire while the account exists.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class TxType(str, Enum):
    PURCHASE = "purchase"          # IAP or web-store coin purchase (credits bought)
    BONUS = "bonus"                # promo / first-pack / web bonus (credits bonus)
    CHECKIN = "checkin"            # daily check-in reward (credits bonus)
    REFERRAL = "referral"          # referral reward (credits bonus)
    UNLOCK = "unlock"              # episode/bundle unlock (debits bonus first, then bought)
    REFUND_CLAWBACK = "refund_clawback"  # Apple/gateway refund reverses a purchase
    ADMIN_ADJUST = "admin_adjust"  # support/finance manual adjustment (audited, dual-approved > 500)


# Coin types that add to the balance vs. remove from it.
CREDIT_TYPES = {TxType.PURCHASE, TxType.BONUS, TxType.CHECKIN, TxType.REFERRAL}
DEBIT_TYPES = {TxType.UNLOCK}


@dataclass(frozen=True)
class Transaction:
    """One immutable row in the append-only ledger.

    amount_bought / amount_bonus are signed: positive credits, negative debits.
    Exactly one of the two pools may move per pool, but a single UNLOCK can draw
    from both (bonus first, then bought) — represented as two negatives here.
    """
    id: str
    user_id: str
    type: TxType
    amount_bought: int
    amount_bonus: int
    reference_type: str          # "iap" | "web_order" | "episode" | "bundle" | "day" | ...
    reference_id: str
    idempotency_key: str
    created_at: str              # ISO-8601; injected, never wall-clock (reproducible)

    @property
    def net(self) -> int:
        return self.amount_bought + self.amount_bonus


@dataclass
class Wallet:
    """Projection of the ledger for one user. Always == replay of the log."""
    user_id: str
    balance_bought: int = 0
    balance_bonus: int = 0

    @property
    def total(self) -> int:
        return self.balance_bought + self.balance_bonus

    def apply(self, tx: Transaction) -> None:
        self.balance_bought += tx.amount_bought
        self.balance_bonus += tx.amount_bonus


@dataclass
class Entitlement:
    user_id: str
    episode_id: str
    source: str                  # "unlock" | "bundle" | "free" | "promo"
    created_at: str


@dataclass
class UnlockResult:
    transaction: Transaction
    entitlements: list[Entitlement] = field(default_factory=list)
    spent_bonus: int = 0
    spent_bought: int = 0

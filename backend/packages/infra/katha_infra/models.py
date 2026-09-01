"""SQLAlchemy 2.0 declarative models for the money projections.

These are the *persistence* shape of the pure ledger primitives — they mirror
`katha_ledger.Transaction`, `Wallet`, and `Entitlement` but add nothing to the
rules. `coin_transaction` is the append-only source of truth; `wallet` and
`entitlement` are projections that can always be rebuilt by replaying it.
"""
from __future__ import annotations

from sqlalchemy import Integer, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class CoinTransactionRow(Base):
    """One append-only ledger row. `idempotency_key` is globally unique."""

    __tablename__ = "coin_transaction"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    amount_bought: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    amount_bonus: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reference_type: Mapped[str] = mapped_column(String, nullable=False)
    reference_id: Mapped[str] = mapped_column(String, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class WalletRow(Base):
    """Balance projection for one user (rebuildable from coin_transaction)."""

    __tablename__ = "wallet"

    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    balance_bought: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    balance_bonus: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class UserProfileRow(Base):
    """Lightweight identity persisted by core-api so the back office can list and
    look up real users (phone/name) alongside the shared ledger."""

    __tablename__ = "user_profile"

    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    phone: Mapped[str] = mapped_column(String, nullable=False, default="")
    kind: Mapped[str] = mapped_column(String, nullable=False, default="guest")  # guest | phone | apple
    language: Mapped[str] = mapped_column(String, nullable=False, default="hi")
    created_at: Mapped[str] = mapped_column(String, nullable=False, default="")


class EntitlementRow(Base):
    """One (user, episode) grant. `source` is free | unlock | bundle | promo."""

    __tablename__ = "entitlement"
    __table_args__ = (UniqueConstraint("user_id", "episode_id", name="uq_user_episode"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    episode_id: Mapped[str] = mapped_column(String, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class KVRow(Base):
    """Small shared key-value store (feature-flag overrides, admin state)."""

    __tablename__ = "admin_kv"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(String(1024))

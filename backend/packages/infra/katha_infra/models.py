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
    last_seen: Mapped[str] = mapped_column(String, nullable=False, default="")
    # Bumped by "sign out all devices" (#021): JWTs carry the version they were
    # issued under and stop validating once it moves.
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


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


class AuditLogRow(Base):
    """Persisted, hash-chained audit trail (admin review #066/#068/#069).

    `hash` = sha256(prev_hash + ts + actor + action + target + detail); any
    edit breaks every later link, making "append-only" checkable, not asserted.
    """

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[str] = mapped_column(String, nullable=False)
    actor_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    actor_role: Mapped[str] = mapped_column(String, nullable=False)
    action: Mapped[str] = mapped_column(String, index=True, nullable=False)
    target: Mapped[str] = mapped_column(String, index=True, nullable=False)
    detail: Mapped[str] = mapped_column(String, nullable=False, default="{}")
    ip: Mapped[str] = mapped_column(String, nullable=False, default="")
    user_agent: Mapped[str] = mapped_column(String, nullable=False, default="")
    prev_hash: Mapped[str] = mapped_column(String, nullable=False, default="")
    hash: Mapped[str] = mapped_column(String, nullable=False, default="")


class EventRow(Base):
    """One product event (admin review #011): the raw material for DAU, funnels,
    watch minutes and every Overview trend. Emitted server-side by core-api at
    the endpoints where the behaviour is already observable — no client SDK yet.
    `day` is the precomputed UTC date for cheap bucketing."""

    __tablename__ = "event"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[str] = mapped_column(String, nullable=False)
    day: Mapped[str] = mapped_column(String, index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String, index=True, nullable=False)
    ref: Mapped[str] = mapped_column(String, nullable=False, default="")
    value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    channel: Mapped[str] = mapped_column(String, nullable=False, default="")


class DeviceRow(Base):
    """One observed client per user (admin review #021), keyed by user-agent
    hash. Recorded on authenticated traffic; "sign out all devices" works by
    bumping the profile's token_version, not by deleting rows."""

    __tablename__ = "device"
    __table_args__ = (UniqueConstraint("user_id", "ua_hash", name="uq_user_ua"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    ua_hash: Mapped[str] = mapped_column(String, nullable=False)
    ua: Mapped[str] = mapped_column(String, nullable=False, default="")
    ip: Mapped[str] = mapped_column(String, nullable=False, default="")
    first_seen: Mapped[str] = mapped_column(String, nullable=False, default="")
    last_seen: Mapped[str] = mapped_column(String, nullable=False, default="")


class GrievanceRow(Base):
    """IT Rules grievance ticket (admin review #073): acknowledge within 24 h,
    resolve within 15 days. Timestamps are real UTC; SLA math derives from them."""

    __tablename__ = "grievance"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False, default="")
    contact: Mapped[str] = mapped_column(String, nullable=False)
    channel: Mapped[str] = mapped_column(String, nullable=False, default="app")
    subject: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(String, nullable=False, default="")
    status: Mapped[str] = mapped_column(String, index=True, nullable=False, default="new")
    assignee: Mapped[str] = mapped_column(String, nullable=False, default="")
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    ack_at: Mapped[str] = mapped_column(String, nullable=False, default="")
    resolved_at: Mapped[str] = mapped_column(String, nullable=False, default="")
    notes: Mapped[str] = mapped_column(String, nullable=False, default="[]")

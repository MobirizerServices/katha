"""SQLAlchemy 2.0 declarative models for the money projections.

These are the *persistence* shape of the pure ledger primitives — they mirror
`katha_ledger.Transaction`, `Wallet`, and `Entitlement` but add nothing to the
rules. `coin_transaction` is the append-only source of truth; `wallet` and
`entitlement` are projections that can always be rebuilt by replaying it.
"""
from __future__ import annotations

from sqlalchemy import Integer, String, Text, UniqueConstraint
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
    value: Mapped[str] = mapped_column(Text, nullable=False)   # whole drafts/experiments live here


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


class PushTokenRow(Base):
    """One APNs device token per (user, device). Registered by the app after
    notification permission; the sender fans out per user or broadcast."""

    __tablename__ = "push_token"
    __table_args__ = (UniqueConstraint("user_id", "token", name="uq_user_token"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    token: Mapped[str] = mapped_column(String, nullable=False)
    platform: Mapped[str] = mapped_column(String, nullable=False, default="ios")
    registered_at: Mapped[str] = mapped_column(String, nullable=False)
    last_seen: Mapped[str] = mapped_column(String, nullable=False, default="")


class InvoiceRow(Base):
    """GST invoice for a WEB (UPI) coin purchase — Apple invoices IAP itself.
    Numbered sequentially per financial year; amounts in paise."""

    __tablename__ = "invoice"

    id: Mapped[str] = mapped_column(String, primary_key=True)   # KATHA-INV-2627-000001
    user_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    order_ref: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    sku: Mapped[str] = mapped_column(String, nullable=False)
    coins: Mapped[int] = mapped_column(Integer, nullable=False)
    bonus_coins: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    taxable_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    gst_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    gst_rate_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=18)
    seller_gstin: Mapped[str] = mapped_column(String, nullable=False, default="")
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class OutboxRow(Base):
    """Every outbound communication (email + push), whatever the transport.
    In dev the transports write ONLY here (nothing leaves the machine); in
    production the same row is written first, then delivered — so the admin
    Outbox view is always the truth about what was sent."""

    __tablename__ = "outbox"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String, index=True, nullable=False)  # email | push
    recipient: Mapped[str] = mapped_column(String, nullable=False)
    subject: Mapped[str] = mapped_column(String, nullable=False, default="")
    body: Mapped[str] = mapped_column(String, nullable=False, default="")
    status: Mapped[str] = mapped_column(String, index=True, nullable=False)  # queued|sent|failed
    detail: Mapped[str] = mapped_column(String, nullable=False, default="")
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class ApprovalRow(Base):
    """A dual-approval request for a coin adjustment above the threshold. Shared
    across every admin-api worker and survives restarts; the status transition
    is a conditional UPDATE so two approvers cannot both apply it."""

    __tablename__ = "approval"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[str] = mapped_column(String, index=True, nullable=False, default="pending")
    requested_by: Mapped[str] = mapped_column(String, nullable=False)
    approved_by: Mapped[str] = mapped_column(String, nullable=False, default="")
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    coins: Mapped[int] = mapped_column(Integer, nullable=False)
    reason_code: Mapped[str] = mapped_column(String, nullable=False)
    note: Mapped[str] = mapped_column(String, nullable=False, default="")
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    decided_at: Mapped[str] = mapped_column(String, nullable=False, default="")

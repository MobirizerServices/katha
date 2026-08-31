"""Admin-api state: the money ledger (reused, pure), an immutable audit log, and
the pending dual-approval queue.

Money always flows through `katha_ledger.admin_adjust` — the admin service never
re-implements a balance rule. Every mutation records an audit row.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from katha_ledger import Ledger

CLOCK = "2026-09-14T14:03:22+05:30"

# Adjustments larger than this (absolute value) require a second approver.
DUAL_APPROVAL_THRESHOLD = 500


@dataclass
class AuditRow:
    id: str
    ts: str
    actor_id: str
    actor_role: str
    action: str
    target: str
    detail: dict


@dataclass
class Approval:
    id: str
    requested_by: str
    user_id: str
    coins: int
    reason_code: str
    note: str
    status: str = "pending"          # pending | approved
    approved_by: str | None = None
    created_at: str = CLOCK


@dataclass
class AdminStore:
    ledger: Ledger = field(default_factory=Ledger)
    audit: list[AuditRow] = field(default_factory=list)
    approvals: dict[str, Approval] = field(default_factory=dict)
    published: set[str] = field(default_factory=set)
    known_users: set[str] = field(default_factory=set)

    # ---- audit (append-only) -------------------------------------------
    def record(self, actor, action: str, target: str, detail: dict) -> AuditRow:
        row = AuditRow(
            id=f"aud_{uuid.uuid4().hex[:12]}", ts=CLOCK,
            actor_id=actor.id, actor_role=actor.role.value,
            action=action, target=target, detail=detail,
        )
        self.audit.append(row)
        return row

    def audit_log(self) -> list[AuditRow]:
        # Return copies so callers can never mutate the log in place.
        return list(self.audit)

    # ---- users ----------------------------------------------------------
    def note_user(self, user_id: str) -> None:
        self.known_users.add(user_id)

    # ---- approvals ------------------------------------------------------
    def create_approval(self, actor, user_id: str, coins: int, reason_code: str,
                        note: str) -> Approval:
        ap = Approval(
            id=f"apr_{uuid.uuid4().hex[:12]}", requested_by=actor.id,
            user_id=user_id, coins=coins, reason_code=reason_code, note=note,
        )
        self.approvals[ap.id] = ap
        return ap


store = AdminStore()


def reset() -> None:
    """Test hook: clear all admin state."""
    store.ledger = Ledger()
    store.audit.clear()
    store.approvals.clear()
    store.published.clear()
    store.known_users.clear()

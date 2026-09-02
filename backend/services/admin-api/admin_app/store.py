"""Admin-api state: the money ledger (reused, pure), an immutable audit log, and
the pending dual-approval queue.

Money always flows through `katha_ledger.admin_adjust` — the admin service never
re-implements a balance rule. Every mutation records an audit row.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from katha_domain.timeutil import now_iso
from katha_ledger import Ledger

# Frozen stamp of the earliest dev rows; all NEW writes use now_iso() (#001).
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
    ip: str = ""
    user_agent: str = ""
    prev_hash: str = ""
    hash: str = ""


@dataclass
class Approval:
    id: str
    requested_by: str
    user_id: str
    coins: int
    reason_code: str
    note: str
    status: str = "pending"          # pending | approved | rejected
    approved_by: str | None = None
    created_at: str = ""


@dataclass
class AdminStore:
    ledger: Ledger = field(default_factory=Ledger)
    audit: list[AuditRow] = field(default_factory=list)
    approvals: dict[str, Approval] = field(default_factory=dict)
    published: set[str] = field(default_factory=set)
    flag_overrides: dict[str, bool] = field(default_factory=dict)
    known_users: set[str] = field(default_factory=set)
    # email → {role, by, at}; the OIDC sign-in directory when persistence is off
    admin_users: dict[str, dict] = field(default_factory=dict)

    # ---- audit (append-only, hash-chained; persisted via SharedStore when
    # persistence is on — this in-memory path serves unit tests) ------------
    def record(self, actor, action: str, target: str, detail: dict,
               *, ip: str = "", user_agent: str = "") -> AuditRow:
        import hashlib
        import json as _json
        ts = now_iso()
        prev = self.audit[-1].hash if self.audit else ""
        detail_s = _json.dumps(detail, sort_keys=True, default=str)
        digest = hashlib.sha256(
            f"{prev}|{ts}|{actor.id}|{action}|{target}|{detail_s}".encode()).hexdigest()
        row = AuditRow(
            id=f"aud_{uuid.uuid4().hex[:12]}", ts=ts,
            actor_id=actor.id, actor_role=actor.role.value,
            action=action, target=target, detail=detail,
            ip=ip, user_agent=user_agent, prev_hash=prev, hash=digest,
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
            created_at=now_iso(),
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

"""Katha admin-api endpoints: catalog ops, user + ledger reads, wallet adjustments
with dual approval above a threshold, and an immutable audit log.

Money is applied only through the pure `katha_ledger.admin_adjust`; every mutation
writes an audit row.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException

from katha_domain import catalog

from .rbac import Actor, Role, require
from .store import DUAL_APPROVAL_THRESHOLD, CLOCK, store

app = FastAPI(
    title="Katha admin-api",
    version="0.1.0",
    description="Back-office API. RBAC-gated, every mutation is audited; coin "
                "adjustments over ±500 require a second approver.",
)

router = APIRouter(prefix="/admin/v1")


@app.get("/health", tags=["ops"])
def health() -> dict:
    return {"status": "ok", "service": "admin-api"}


def _audit_row(row) -> dict:
    return {
        "id": row.id, "ts": row.ts, "actor_id": row.actor_id,
        "actor_role": row.actor_role, "action": row.action,
        "target": row.target, "detail": row.detail,
    }


def _approval_view(ap) -> dict:
    return {
        "id": ap.id, "status": ap.status, "requested_by": ap.requested_by,
        "approved_by": ap.approved_by, "user_id": ap.user_id, "coins": ap.coins,
        "reason_code": ap.reason_code, "note": ap.note, "created_at": ap.created_at,
    }


def _wallet_view(user_id: str) -> dict:
    w = store.ledger.balance(user_id)
    return {"user_id": user_id, "balance_bought": w.balance_bought,
            "balance_bonus": w.balance_bonus, "total": w.total}


def _apply_adjust(user_id: str, coins: int, reason_code: str, ref_id: str) -> None:
    store.note_user(user_id)
    store.ledger.admin_adjust(
        user_id, coins=coins, reference_type=f"admin_adjust:{reason_code}",
        reference_id=ref_id, idempotency_key=ref_id, created_at=CLOCK,
    )


# ---- catalog ---------------------------------------------------------------
@router.get("/series", tags=["catalog"])
def list_series(actor: Actor = Depends(require(Role.CONTENT, Role.QC, Role.ANALYST, Role.RO))):
    return [
        {"slug": s.slug, "title": s.title, "episode_count": s.episode_count,
         "primary_language": s.primary_language, "published": s.slug in store.published}
        for s in catalog.summaries()
    ]


@router.post("/series/{slug}/publish", tags=["catalog"])
def publish_series(slug: str, actor: Actor = Depends(require(Role.CONTENT))):
    if catalog.get_series(slug) is None:
        raise HTTPException(status_code=404, detail="series not found")
    store.published.add(slug)
    store.record(actor, "series.publish", slug, {"slug": slug})
    return {"slug": slug, "published": True}


# ---- users -----------------------------------------------------------------
@router.get("/users", tags=["users"])
def list_users(actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE, Role.ANALYST))):
    return [_wallet_view(u) for u in sorted(store.known_users)]


@router.get("/users/{user_id}/ledger", tags=["users"])
def user_ledger(user_id: str,
                actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE, Role.ANALYST))):
    txns = [
        {"id": t.id, "type": t.type.value, "amount_bought": t.amount_bought,
         "amount_bonus": t.amount_bonus, "reference_type": t.reference_type,
         "reference_id": t.reference_id, "created_at": t.created_at}
        for t in store.ledger.transactions(user_id)
    ]
    return {"user_id": user_id, "wallet": _wallet_view(user_id), "transactions": txns}


# ---- wallet adjustments (dual approval > threshold) ------------------------
@router.post("/wallet/adjust", tags=["wallet"])
def wallet_adjust(
    body: dict = Body(...),
    actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE)),
):
    user_id = (body.get("user_id") or "").strip()
    reason_code = (body.get("reason_code") or "").strip()
    note = (body.get("note") or "").strip()
    coins = body.get("coins")
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id required")
    if not reason_code:
        raise HTTPException(status_code=400, detail="reason_code required")
    if not isinstance(coins, int) or coins == 0:
        raise HTTPException(status_code=400, detail="coins must be a non-zero integer")

    # Above the threshold: do NOT apply — queue a pending approval for a 2nd actor.
    if abs(coins) > DUAL_APPROVAL_THRESHOLD:
        ap = store.create_approval(actor, user_id, coins, reason_code, note)
        store.record(actor, "wallet.adjust.requested", user_id,
                     {"approval_id": ap.id, "coins": coins, "reason_code": reason_code})
        return {"status": "pending_approval", "approval": _approval_view(ap)}

    # Within the threshold: apply immediately.
    ref = f"adjust:{uuid.uuid4().hex[:12]}"
    _apply_adjust(user_id, coins, reason_code, ref)
    store.record(actor, "wallet.adjust.applied", user_id,
                 {"coins": coins, "reason_code": reason_code, "ref": ref})
    return {"status": "applied", "wallet": _wallet_view(user_id)}


@router.post("/approvals/{approval_id}/approve", tags=["wallet"])
def approve(approval_id: str, actor: Actor = Depends(require(Role.FINANCE))):
    ap = store.approvals.get(approval_id)
    if ap is None:
        raise HTTPException(status_code=404, detail="approval not found")
    if ap.status == "approved":
        raise HTTPException(status_code=409, detail="already approved")
    # Separation of duties: the requester cannot approve their own request.
    if actor.id == ap.requested_by:
        raise HTTPException(status_code=403, detail="requester cannot self-approve")

    _apply_adjust(ap.user_id, ap.coins, ap.reason_code, f"adjust:{ap.id}")
    ap.status = "approved"
    ap.approved_by = actor.id
    store.record(actor, "wallet.adjust.approved", ap.user_id,
                 {"approval_id": ap.id, "coins": ap.coins, "requested_by": ap.requested_by})
    return {"status": "applied", "approval": _approval_view(ap),
            "wallet": _wallet_view(ap.user_id)}


# ---- audit -----------------------------------------------------------------
@router.get("/audit", tags=["audit"])
def audit_log(actor: Actor = Depends(require(Role.FINANCE, Role.ANALYST, Role.RO))):
    return [_audit_row(r) for r in store.audit_log()]


app.include_router(router)

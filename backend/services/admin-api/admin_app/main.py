"""Katha admin-api endpoints: catalog ops, user + ledger reads, wallet adjustments
with dual approval above a threshold, and an immutable audit log.

Money is applied only through the pure `katha_ledger.admin_adjust`; every mutation
writes an audit row.
"""
from __future__ import annotations

import os
import uuid

from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from katha_domain import catalog
from katha_domain.flags import DEFAULT_FLAGS, effective_flags

from .rbac import Actor, Role, require
from .store import DUAL_APPROVAL_THRESHOLD, CLOCK, store

app = FastAPI(
    title="Katha admin-api",
    version="0.1.0",
    description="Back-office API. RBAC-gated, every mutation is audited; coin "
                "adjustments over ±500 require a second approver.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get(
        "KATHA_ADMIN_CORS", "http://localhost:5173,http://localhost:5174"
    ).split(","),
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# In persist mode, admin-api reads/writes the SAME ledger DB core-api writes,
# fresh per request — so a purchase in the app/web is visible in the back office.
SHARED = None
if os.environ.get("KATHA_PERSIST") == "1":
    from katha_infra import SharedStore
    SHARED = SharedStore()

router = APIRouter(prefix="/admin/v1")


def _rupees(coins: int) -> str:
    return f"₹{round(coins * 0.15):,}"


def _admin_user_view(u: dict) -> dict:
    """Map a shared-store user row to the AdminUser shape the web/admin client renders."""
    total = u["balance_bought"] + u["balance_bonus"]
    return {
        "id": u["user_id"],
        "phone": u.get("phone") or "(guest)",
        "name": "—",
        "languages": u.get("language", "hi"),
        "wallet": {"bought": u["balance_bought"], "bonus": u["balance_bonus"],
                   "unlocked": u.get("unlocked", 0), "ltv": _rupees(total)},
        "lastActive": "recently",
        "flags": [],
        "devices": [],
        "payer": "web/app" if u["balance_bought"] > 0 else "—",
    }


@app.get("/health", tags=["ops"])
def health() -> dict:
    return {"status": "ok", "service": "admin-api"}


def _audit_row(row) -> dict:
    # The back-office client shape (AuditEntry) + the ids tests key on.
    return {
        "id": row.id, "ts": row.ts, "actor": row.actor_id,
        "actor_id": row.actor_id, "actor_role": row.actor_role,
        "action": row.action, "entity": row.target, "target": row.target,
        "change": ", ".join(f"{k}={v}" for k, v in row.detail.items()),
        "detail": row.detail,
    }


def _approval_view(ap) -> dict:
    return {
        "id": ap.id, "status": ap.status, "requested_by": ap.requested_by,
        "approved_by": ap.approved_by, "user_id": ap.user_id, "coins": ap.coins,
        "reason_code": ap.reason_code, "note": ap.note, "created_at": ap.created_at,
    }


def _wallet_view(user_id: str) -> dict:
    if SHARED is not None:
        return SHARED.wallet(user_id)
    w = store.ledger.balance(user_id)
    return {"user_id": user_id, "balance_bought": w.balance_bought,
            "balance_bonus": w.balance_bonus, "total": w.total}


def _apply_adjust(user_id: str, coins: int, reason_code: str, ref_id: str) -> None:
    store.note_user(user_id)
    if SHARED is not None:
        # Writes to the same ledger core-api reads (idempotent by ref_id).
        SHARED.admin_adjust(user_id, coins=coins, reason_code=reason_code,
                            ref_id=ref_id, created_at=CLOCK)
    else:
        store.ledger.admin_adjust(
            user_id, coins=coins, reference_type=f"admin_adjust:{reason_code}",
            reference_id=ref_id, idempotency_key=ref_id, created_at=CLOCK,
        )


_LANG_NAMES = {"hi": "Hindi", "ta": "Tamil", "te": "Telugu"}


@router.get("/overview", tags=["overview"])
def overview(actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE, Role.ANALYST, Role.RO))):
    """Live KPI counters from the shared ledger; attention/pipeline stay empty in
    the dev slice (they come from ops tooling that does not exist yet)."""
    if SHARED is not None:
        st = SHARED.overview_stats()
    else:
        users = sorted(store.known_users)
        st = {
            "users": len(users),
            "coins_outstanding_bought": sum(store.ledger.balance(u).balance_bought for u in users),
            "coins_outstanding_bonus": sum(store.ledger.balance(u).balance_bonus for u in users),
            "episodes_unlocked": 0,
            "coins_purchased": 0,
        }
    outstanding = st["coins_outstanding_bought"] + st["coins_outstanding_bonus"]
    return {
        "kpis": [
            {"label": "Registered users", "value": f"{st['users']:,}"},
            {"label": "Coins purchased (all time)", "value": f"{st['coins_purchased']:,}"},
            {"label": "Coins outstanding", "value": f"{outstanding:,}",
             "delta": f"{st['coins_outstanding_bonus']:,} bonus", "deltaDir": "up"},
            {"label": "Episodes unlocked", "value": f"{st['episodes_unlocked']:,}"},
            {"label": "Gross revenue equivalent", "value": _rupees(st["coins_purchased"])},
            {"label": "Live series", "value": str(len(catalog.summaries()))},
        ],
        "attention": [],
        "pipeline": [],
    }


@router.get("/catalog/series", tags=["catalog"])
def catalog_series(actor: Actor = Depends(require(Role.CONTENT, Role.QC, Role.ANALYST, Role.RO))):
    """The live catalog in the back-office client shape."""
    out = []
    for i, s in enumerate(catalog.all_series()):
        out.append({
            "id": s.slug, "slug": s.slug, "title": s.title, "synopsis": s.synopsis,
            "genres": s.genres, "language": _LANG_NAMES.get(s.primary_language, s.primary_language),
            "episodeCount": s.episode_count, "liveCount": s.episode_count,
            "freeEpisodes": s.free_episode_count, "coinPrice": s.episode_coin_price,
            "bundleDiscountPct": s.bundle_discount_pct,
            "status": "live", "rating": s.content_rating,
            "owner": "Katha Originals", "updatedAt": 0,
        })
    return out


@router.get("/approvals", tags=["wallet"])
def list_approvals(actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE, Role.ANALYST))):
    """Pending approvals in the back-office client shape."""
    return [
        {
            "id": ap.id, "kind": "Coin adjustment",
            "detail": f"{ap.coins:+,} coins · {ap.user_id} · reason: {ap.reason_code}"
                      + (f" · {ap.note}" if ap.note else ""),
            "requestedBy": ap.requested_by, "when": ap.created_at,
            "needs": "Finance or Admin", "amount": ap.coins, "userId": ap.user_id,
        }
        for ap in store.approvals.values() if ap.status == "pending"
    ]


@router.post("/approvals/{approval_id}/reject", tags=["wallet"])
def reject(approval_id: str, body: dict = Body(default={}),
           actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE))):
    ap = store.approvals.get(approval_id)
    if ap is None:
        raise HTTPException(status_code=404, detail="approval not found")
    if ap.status != "pending":
        raise HTTPException(status_code=409, detail=f"already {ap.status}")
    ap.status = "rejected"
    store.record(actor, "wallet.adjust.rejected", ap.user_id,
                 {"approval_id": ap.id, "coins": ap.coins,
                  "note": (body.get("note") or "").strip()})
    return {"status": "rejected", "approval": _approval_view(ap)}


@router.get("/config/flags", tags=["config"])
def config_flags(actor: Actor = Depends(require(Role.CONTENT, Role.FINANCE, Role.ANALYST, Role.RO))):
    overrides = SHARED.flag_overrides() if SHARED is not None else store.flag_overrides
    merged = effective_flags(overrides)
    return [
        {"key": k, "description": DEFAULT_FLAGS[k]["description"],
         "enabled": merged[k], "env": "prod"}
        for k in DEFAULT_FLAGS
    ]


@router.patch("/config/flags/{key}", tags=["config"])
def set_flag(key: str, body: dict = Body(...),
             actor: Actor = Depends(require(Role.CONTENT))):
    """Flip a flag. Persists to the shared DB, so core-api's /v1/config serves
    the new value on its very next request. Audited like every mutation."""
    if key not in DEFAULT_FLAGS:
        raise HTTPException(status_code=404, detail="unknown flag")
    enabled = bool(body.get("enabled"))
    overrides = SHARED.flag_overrides() if SHARED is not None else store.flag_overrides
    current = effective_flags(overrides)[key]
    if current == enabled:                       # no-op writes are not audited
        return {"key": key, "enabled": enabled}
    if SHARED is not None:
        SHARED.set_flag(key, enabled)
    else:
        store.flag_overrides[key] = enabled
    store.record(actor, "config.flag.set", key, {"enabled": enabled})
    return {"key": key, "enabled": enabled}


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
    # Live (shared DB): the real users core-api created, in the web-client shape.
    if SHARED is not None:
        return [_admin_user_view(u) for u in SHARED.list_users()]
    # In-memory (unit tests): the users this admin process has touched.
    return [_admin_user_view({"user_id": u, "phone": "", "kind": "guest",
                              "language": "hi", "balance_bought": store.ledger.balance(u).balance_bought,
                              "balance_bonus": store.ledger.balance(u).balance_bonus, "unlocked": 0})
            for u in sorted(store.known_users)]


@router.get("/users/{user_id}/ledger", tags=["users"])
def user_ledger(user_id: str,
                actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE, Role.ANALYST))):
    if SHARED is not None:
        w = SHARED.wallet(user_id)
        txs = SHARED.transactions(user_id)
    else:
        wv = store.ledger.balance(user_id)
        w = {"user_id": user_id, "balance_bought": wv.balance_bought,
             "balance_bonus": wv.balance_bonus, "total": wv.total}
        txs = store.ledger.transactions(user_id)
    txns = [
        {"id": t.id, "type": t.type.value, "amount_bought": t.amount_bought,
         "amount_bonus": t.amount_bonus, "reference_type": t.reference_type,
         "reference_id": t.reference_id, "created_at": t.created_at}
        for t in txs
    ]
    return {"user_id": user_id, "wallet": w, "transactions": txns}


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

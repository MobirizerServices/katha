"""Katha admin-api endpoints: catalog ops, user + ledger reads, wallet adjustments
with dual approval above a threshold, and an immutable audit log.

Money is applied only through the pure `katha_ledger.admin_adjust`; every mutation
writes an audit row.
"""
from __future__ import annotations

import json as _json
import os
import time
import urllib.request
import uuid
from collections import defaultdict
from pathlib import Path

from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from katha_domain import catalog
from katha_domain.flags import DEFAULT_FLAGS, effective_flags
from katha_domain.timeutil import now_iso

from .rbac import Actor, MATRIX, Role, require
from .store import DUAL_APPROVAL_THRESHOLD, store

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


@app.middleware("http")
async def _metrics_mw(request: Request, call_next):
    t0 = time.monotonic()
    try:
        response = await call_next(request)
        ok = response.status_code < 500
        return response
    except Exception:
        ok = False
        raise
    finally:
        m = REQUEST_METRICS[f"{request.method} {request.url.path}"]
        m["count"] += 1
        m["ms"] += (time.monotonic() - t0) * 1000
        if not ok:
            m["errors"] += 1


def audit(actor: Actor, action: str, target: str, detail: dict,
          request: Request | None = None) -> None:
    ip = request.client.host if request and request.client else ""
    ua = request.headers.get("user-agent", "") if request else ""
    store.record(actor, action, target, detail, ip=ip, user_agent=ua)
    if SHARED is not None:
        SHARED.audit_append(ts=now_iso(), actor_id=actor.id,
                            actor_role=actor.role.value, action=action,
                            target=target,
                            detail=", ".join(f"{k}={v}" for k, v in detail.items()),
                            ip=ip, user_agent=ua)


REQUEST_METRICS: dict = defaultdict(lambda: {"count": 0, "errors": 0, "ms": 0.0})


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
                            ref_id=ref_id, created_at=now_iso())
    else:
        store.ledger.admin_adjust(
            user_id, coins=coins, reference_type=f"admin_adjust:{reason_code}",
            reference_id=ref_id, idempotency_key=ref_id, created_at=now_iso(),
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
        "attention": attention(actor)["items"] if SHARED is not None else [],
        "pipeline": [],
        "generated_at": now_iso(),
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
def list_approvals(status: str = "pending",
                   actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE, Role.ANALYST))):
    """Approvals with history (#047), balance impact (#048) and requester
    day-context (#052). status: pending | approved | rejected | all."""
    from collections import Counter
    day_counts = Counter(ap.requested_by for ap in store.approvals.values()
                         if ap.created_at[:10] == now_iso()[:10])
    out = []
    for ap in store.approvals.values():
        if status != "all" and ap.status != status:
            continue
        bal = _wallet_view(ap.user_id)["total"] if ap.status == "pending" else None
        out.append({
            "id": ap.id, "kind": "Coin adjustment", "status": ap.status,
            "detail": f"{ap.coins:+,} coins · {ap.user_id} · reason: {ap.reason_code}"
                      + (f" · {ap.note}" if ap.note else ""),
            "requestedBy": ap.requested_by, "when": ap.created_at,
            "needs": "Finance or Admin", "amount": ap.coins, "userId": ap.user_id,
            "balanceBefore": bal,
            "balanceAfter": (bal + ap.coins) if bal is not None else None,
            "requesterToday": day_counts.get(ap.requested_by, 0),
            "approvedBy": ap.approved_by,
        })
    out.sort(key=lambda a: a["when"], reverse=True)
    return out


@router.post("/approvals/{approval_id}/reject", tags=["wallet"])
def reject(approval_id: str, request: Request = None, body: dict = Body(default={}),
           actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE))):
    ap = store.approvals.get(approval_id)
    if ap is None:
        raise HTTPException(status_code=404, detail="approval not found")
    if ap.status != "pending":
        raise HTTPException(status_code=409, detail=f"already {ap.status}")
    ap.status = "rejected"
    audit(actor, "wallet.adjust.rejected", ap.user_id,
          {"approval_id": ap.id, "coins": ap.coins,
           "note": (body.get("note") or "").strip()}, request)
    return {"status": "rejected", "approval": _approval_view(ap)}


@router.get("/config/flags", tags=["config"])
def config_flags(actor: Actor = Depends(require(Role.CONTENT, Role.FINANCE, Role.ANALYST, Role.RO))):
    overrides = SHARED.flag_overrides() if SHARED is not None else store.flag_overrides
    merged = effective_flags(overrides)
    return [
        {"key": k, "description": DEFAULT_FLAGS[k]["description"],
         "enabled": merged[k], "env": "prod",
         "guarded": bool(DEFAULT_FLAGS[k].get("guarded")),
         "owner": DEFAULT_FLAGS[k].get("owner", ""),
         "review_by": DEFAULT_FLAGS[k].get("review_by", "")}
        for k in DEFAULT_FLAGS
    ]


@router.patch("/config/flags/{key}", tags=["config"])
def set_flag(key: str, request: Request = None, body: dict = Body(...),
             actor: Actor = Depends(require(Role.CONTENT))):
    """Flip a flag. Persists to the shared DB, so core-api's /v1/config serves
    the new value on its very next request. Audited like every mutation."""
    if key not in DEFAULT_FLAGS:
        raise HTTPException(status_code=404, detail="unknown flag")
    enabled = bool(body.get("enabled"))
    if DEFAULT_FLAGS[key].get("guarded") and body.get("confirm") != key:
        raise HTTPException(status_code=428,
                            detail=f"guarded flag: repeat the key '{key}' as confirm")
    overrides = SHARED.flag_overrides() if SHARED is not None else {
        k: v for k, v in store.flag_overrides.items() if isinstance(v, bool)}
    current = effective_flags(overrides)[key]
    if current == enabled:                       # no-op writes are not audited
        return {"key": key, "enabled": enabled}
    if SHARED is not None:
        SHARED.set_flag(key, enabled)
    else:
        store.flag_overrides[key] = enabled
    audit(actor, "config.flag.set", key,
          {"from": current, "to": enabled}, request)
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
def publish_series(slug: str, request: Request = None,
                   actor: Actor = Depends(require(Role.CONTENT))):
    if catalog.get_series(slug) is None:
        raise HTTPException(status_code=404, detail="series not found")
    store.published.add(slug)
    audit(actor, "series.publish", slug, {"slug": slug}, request)
    return {"slug": slug, "published": True}


# ---- users -----------------------------------------------------------------
@router.get("/users", tags=["users"])
def list_users(q: str = "", limit: int = 50, offset: int = 0, sort: str = "recent",
               segment: str = "",
               actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE, Role.ANALYST))):
    """Server-side search / pagination / sort over the real user directory
    (admin review #017–#019). PII is masked by role at the server (#078)."""
    limit = max(1, min(limit, 200))
    if SHARED is not None:
        page = SHARED.search_users(q=q, limit=limit, offset=offset,
                                   sort=sort, segment=segment)
        users, total = page["users"], page["total"]
    else:
        users = [{"user_id": u, "phone": "", "kind": "guest", "language": "hi",
                  "last_seen": "",
                  "balance_bought": store.ledger.balance(u).balance_bought,
                  "balance_bonus": store.ledger.balance(u).balance_bonus,
                  "total": store.ledger.balance(u).total, "unlocked": 0}
                 for u in sorted(store.known_users) if q.lower() in u.lower()]
        total = len(users)
        users = users[offset:offset + limit]
    mask = actor.role not in (Role.ADMIN, Role.SUPPORT)      # finance & below: masked
    out = []
    for u in users:
        v = _admin_user_view(u)
        if mask and v["phone"] not in ("", "(guest)"):
            v["phone"] = "•••• masked"
        v["lastActive"] = u.get("last_seen") or "never"
        out.append(v)
    return {"users": out, "total": total, "offset": offset, "limit": limit}


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
    request: Request,
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
    if not isinstance(coins, int) or coins == 0 or abs(coins) > 100_000:
        raise HTTPException(status_code=400,
                            detail="coins must be a non-zero integer within ±100,000")

    # Above the threshold: do NOT apply — queue a pending approval for a 2nd actor.
    if abs(coins) > DUAL_APPROVAL_THRESHOLD:
        ap = store.create_approval(actor, user_id, coins, reason_code, note)
        audit(actor, "wallet.adjust.requested", user_id,
              {"approval_id": ap.id, "coins": coins, "reason_code": reason_code}, request)
        return {"status": "pending_approval", "approval": _approval_view(ap)}

    # Within the threshold: apply immediately.
    ref = f"adjust:{uuid.uuid4().hex[:12]}"
    _apply_adjust(user_id, coins, reason_code, ref)
    audit(actor, "wallet.adjust.applied", user_id,
          {"coins": coins, "reason_code": reason_code, "ref": ref}, request)
    return {"status": "applied", "ref": ref, "wallet": _wallet_view(user_id)}


@router.post("/approvals/{approval_id}/approve", tags=["wallet"])
def approve(approval_id: str, request: Request = None,
            actor: Actor = Depends(require(Role.FINANCE))):
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
    audit(actor, "wallet.adjust.approved", ap.user_id,
          {"approval_id": ap.id, "coins": ap.coins, "requested_by": ap.requested_by}, request)
    return {"status": "applied", "approval": _approval_view(ap),
            "wallet": _wallet_view(ap.user_id)}


# ---- user drill-downs: entitlements, timeline, DPDP, refunds ---------------
@router.get("/users/{user_id}/entitlements", tags=["users"])
def user_entitlements(user_id: str,
                      actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE, Role.ANALYST))):
    if SHARED is None:
        return {"user_id": user_id, "entitlements": []}
    return {"user_id": user_id, "entitlements": SHARED.entitlements(user_id)}


@router.get("/users/{user_id}/timeline", tags=["users"])
def user_timeline(user_id: str, limit: int = 100,
                  actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE, Role.ANALYST))):
    """One chronological stream: money rows + admin actions targeting the user
    (admin review #031)."""
    events = []
    if SHARED is not None:
        for t in SHARED.transactions(user_id):
            events.append({"ts": t.created_at, "kind": "ledger", "type": t.type.value,
                           "detail": t.reference_id,
                           "net": t.amount_bought + t.amount_bonus})
        admin_rows = SHARED.audit_list(limit=500)["rows"]
        for r in admin_rows:
            if r["entity"] == user_id:
                events.append({"ts": r["ts"], "kind": "admin", "type": r["action"],
                               "detail": r["change"], "net": 0})
    events.sort(key=lambda e: e["ts"], reverse=True)
    return {"user_id": user_id, "events": events[:limit]}


@router.get("/users/{user_id}/export", tags=["users"])
def user_export(user_id: str, request: Request = None,
                actor: Actor = Depends(require())):
    """DPDP data-access export (admin review #032). Admin-only; audited."""
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    audit(actor, "dpdp.export", user_id, {}, request)
    return SHARED.export_user(user_id)


@router.post("/users/{user_id}/erase", tags=["users"])
def user_erase(user_id: str, request: Request = None,
               actor: Actor = Depends(require())):
    """DPDP verified-erasure: scrub PII, retain the money ledger (admin review
    #032). Admin-only; audited."""
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    if not SHARED.erase_user(user_id, now_iso()):
        raise HTTPException(status_code=404, detail="user not found")
    audit(actor, "dpdp.erase", user_id, {"pii": "scrubbed", "ledger": "retained"}, request)
    return {"user_id": user_id, "status": "erased"}


@router.post("/wallet/refund", tags=["wallet"])
def wallet_refund(request: Request, body: dict = Body(...),
                  actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE))):
    """Refund a specific purchase: claws the coins back against that transaction
    (admin review #029). Distinct from goodwill adjustments."""
    user_id = (body.get("user_id") or "").strip()
    tx_id = (body.get("tx_id") or "").strip()
    if not user_id or not tx_id:
        raise HTTPException(status_code=400, detail="user_id and tx_id required")
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    tx = SHARED.find_transaction(user_id, tx_id)
    if tx is None:
        raise HTTPException(status_code=404, detail="transaction not found for user")
    if tx["type"] != "purchase":
        raise HTTPException(status_code=409, detail="only purchases are refundable")
    coins = tx["amount_bought"] + tx["amount_bonus"]
    wallet = SHARED.refund(user_id, coins=coins, reference_id=tx["id"],
                           ref_key=f"refund:{tx['id']}", created_at=now_iso())
    audit(actor, "wallet.refund", user_id,
          {"tx": tx_id, "coins": coins, "sku": tx["reference_id"]}, request)
    return {"status": "refunded", "coins": coins, "wallet": wallet}


# ---- catalog detail, lifecycle, rating (admin review #033/#035/#038/#041) --
def _media_root() -> Path:
    import os
    return Path(os.environ.get("KATHA_MEDIA_DIR",
                Path(__file__).resolve().parents[4] / "media"))


def _media_health(slug: str, episode_count: int) -> dict:
    base = _media_root() / slug
    have_cover = (base / "cover_9x16.jpg").is_file() and (base / "cover_16x9.jpg").is_file()
    live = 0
    for n in range(1, episode_count + 1):
        if (base / f"e{n:03d}" / "hls" / "master.m3u8").is_file():
            live += 1
    return {"covers_ok": have_cover, "episodes_with_media": live,
            "episodes_missing": episode_count - live}


def _series_overrides(slug: str) -> tuple[str, dict, str]:
    status = "live"
    rating: dict = {}
    touched = ""
    if SHARED is not None:
        status = SHARED.kv_get(f"status:{slug}") or "live"
        raw = SHARED.kv_get(f"rating:{slug}")
        if raw:
            try:
                rating = _json.loads(raw)
            except ValueError:
                rating = {}
        touched = SHARED.kv_get(f"touched:{slug}") or ""
    else:
        status = store.flag_overrides.get(f"status:{slug}", "live")  # test fallback
    return status, rating, touched


@router.get("/catalog/series/{slug}", tags=["catalog"])
def catalog_series_detail(slug: str,
                          actor: Actor = Depends(require(Role.CONTENT, Role.QC,
                                                         Role.ANALYST, Role.RO))):
    d = catalog.get_series(slug)
    if d is None:
        raise HTTPException(status_code=404, detail="series not found")
    status, rating, touched = _series_overrides(slug)
    return {
        "slug": d.slug, "title": d.title, "synopsis": d.synopsis,
        "genres": d.genres, "language": _LANG_NAMES.get(d.primary_language,
                                                        d.primary_language),
        "episodeCount": d.episode_count, "freeEpisodes": d.free_episode_count,
        "coinPrice": d.episode_coin_price, "bundleDiscountPct": d.bundle_discount_pct,
        "status": status,
        "rating": rating.get("value") or d.content_rating,
        "ratingHistory": rating, "updatedAt": touched,
        "coverUrl": f"{catalog.media_base()}/media/{slug}/cover_9x16.jpg",
        "media": _media_health(slug, d.episode_count),
        "episodes": [{"number": e.number, "title": e.title, "isFree": e.is_free}
                     for e in d.episodes],
        "previewWeb": f"http://localhost:3000/watch/{slug}/1",
    }


@router.post("/catalog/series/{slug}/status", tags=["catalog"])
def set_series_status(slug: str, request: Request = None, body: dict = Body(...),
                      actor: Actor = Depends(require(Role.CONTENT, Role.QC))):
    """Lifecycle control: live | scheduled | draft | archived. Archived/draft
    series disappear from the public catalog on core-api's next request
    (admin review #035/#046). QC may only take DOWN (archive)."""
    if catalog.get_series(slug) is None:
        raise HTTPException(status_code=404, detail="series not found")
    status = (body.get("status") or "").strip()
    reason = (body.get("reason") or "").strip()
    if status not in ("live", "scheduled", "draft", "archived"):
        raise HTTPException(status_code=400, detail="bad status")
    if actor.role == Role.QC and status != "archived":
        raise HTTPException(status_code=403, detail="qc may only take down")
    if status == "archived" and not reason:
        raise HTTPException(status_code=400, detail="takedown requires a reason")
    if SHARED is not None:
        SHARED.kv_set(f"status:{slug}", status)
        SHARED.kv_set(f"touched:{slug}", now_iso())
    else:
        store.flag_overrides[f"status:{slug}"] = status
    audit(actor, "series.status", slug, {"to": status, "reason": reason}, request)
    return {"slug": slug, "status": status}


@router.patch("/catalog/series/{slug}/rating", tags=["catalog"])
def set_series_rating(slug: str, request: Request = None, body: dict = Body(...),
                      actor: Actor = Depends(require(Role.QC, Role.CONTENT))):
    """IT Rules self-classification with accountability: who, when, why
    (admin review #041)."""
    if catalog.get_series(slug) is None:
        raise HTTPException(status_code=404, detail="series not found")
    value = (body.get("rating") or "").strip()
    reason = (body.get("reason") or "").strip()
    if value not in ("U", "U/A 7+", "U/A 13+", "U/A 16+", "A"):
        raise HTTPException(status_code=400, detail="bad rating")
    if not reason:
        raise HTTPException(status_code=400, detail="rating change requires a reason")
    record = {"value": value, "by": actor.id, "at": now_iso(), "reason": reason}
    if SHARED is not None:
        SHARED.kv_set(f"rating:{slug}", _json.dumps(record))
        SHARED.kv_set(f"touched:{slug}", now_iso())
    audit(actor, "series.rating", slug, {"to": value, "reason": reason}, request)
    return {"slug": slug, "rating": record}


# ---- policy / values / packs (admin review #051/#059/#060/#064) ------------
@router.get("/config/policy", tags=["config"])
def config_policy(actor: Actor = Depends(require(Role.CONTENT, Role.SUPPORT,
                                                 Role.FINANCE, Role.ANALYST, Role.RO))):
    prof = catalog.pricing()
    return {
        "dual_approval_threshold": DUAL_APPROVAL_THRESHOLD,
        "coin_rupee_rate": 0.15,
        "pricing": prof,
        "min_app_version": (SHARED.kv_get("config:app.min_version")
                            if SHARED is not None else None) or "1.0.0",
    }


@router.patch("/config/values/app.min_version", tags=["config"])
def set_min_version(request: Request = None, body: dict = Body(...),
                    actor: Actor = Depends(require())):
    value = (body.get("value") or "").strip()
    if not value or len(value) > 32:
        raise HTTPException(status_code=400, detail="bad version value")
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    old_v = SHARED.kv_get("config:app.min_version") or "1.0.0"
    SHARED.kv_set("config:app.min_version", value)
    audit(actor, "config.value.set", "app.min_version",
          {"from": old_v, "to": value}, request)
    return {"key": "app.min_version", "value": value}


@router.get("/config/packs", tags=["config"])
def config_packs(actor: Actor = Depends(require(Role.FINANCE, Role.ANALYST, Role.RO))):
    from app.routers.wallet import effective_packs  # same merge core-api sells with
    return [{"sku": sku, **p} for sku, p in effective_packs().items()]


@router.patch("/config/packs/{sku}", tags=["config"])
def set_pack(sku: str, request: Request = None, body: dict = Body(...),
             actor: Actor = Depends(require(Role.FINANCE))):
    """Guarded pack edit (admin review #059): typed confirm required; audited;
    core-api sells the merged values on its next request."""
    from app.routers.wallet import PACKS
    if sku not in PACKS:
        raise HTTPException(status_code=404, detail="unknown sku")
    if body.get("confirm") != sku:
        raise HTTPException(status_code=428, detail="type the sku to confirm")
    fields = {k: int(body[k]) for k in ("price_minor", "coins", "bonus") if k in body}
    if not fields or any(v < 0 or v > 10_000_000 for v in fields.values()):
        raise HTTPException(status_code=400, detail="bad pack values")
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    SHARED.kv_set(f"pack:{sku}", _json.dumps(fields))
    audit(actor, "config.pack.set", sku, fields, request)
    return {"sku": sku, **fields}


# ---- health / attention / metrics / access matrix / grievances -------------
@router.get("/health/full", tags=["ops"])
def health_full():
    checks = {}
    try:
        with urllib.request.urlopen("http://127.0.0.1:8799/health", timeout=1.5) as r:
            checks["core_api"] = "ok" if r.status == 200 else "degraded"
    except Exception:
        checks["core_api"] = "down"
    try:
        if SHARED is not None:
            SHARED.kv_get("health:probe")
            checks["database"] = "ok"
        else:
            checks["database"] = "memory"
    except Exception:
        checks["database"] = "down"
    checks["media"] = "ok" if _media_root().is_dir() else "missing"
    worst = ("down" if "down" in checks.values()
             else "degraded" if "degraded" in checks.values() else "ok")
    return {"status": worst, "checks": checks, "at": now_iso()}


@router.get("/attention", tags=["ops"])
def attention(actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE,
                                             Role.CONTENT, Role.ANALYST, Role.RO))):
    """Real signals only (admin review #006): pending approvals, grievance SLA,
    service health, media gaps. Empty means genuinely clear."""
    items = []
    pending = [ap for ap in store.approvals.values() if ap.status == "pending"]
    if pending:
        items.append({"id": "approvals", "severity": "warn",
                      "title": f"{len(pending)} approval(s) waiting",
                      "detail": "Coin adjustments above 500 need a second person.",
                      "to": "/approvals"})
    if SHARED is not None:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        for g in SHARED.grievance_list():
            if g["status"] == "resolved":
                continue
            created = datetime.fromisoformat(g["created_at"])
            age_h = (now - created).total_seconds() / 3600
            if g["status"] == "new" and age_h > 24:
                items.append({"id": g["id"], "severity": "danger",
                              "title": f"Grievance {g['id']} breaches 24 h acknowledgement",
                              "detail": g["subject"], "to": "/grievances"})
            elif age_h > 15 * 24:
                items.append({"id": g["id"], "severity": "danger",
                              "title": f"Grievance {g['id']} breaches 15-day resolution",
                              "detail": g["subject"], "to": "/grievances"})
    h = health_full()
    if h["status"] != "ok":
        items.append({"id": "health", "severity": "danger",
                      "title": "A service is unhealthy",
                      "detail": ", ".join(f"{k}: {v}" for k, v in h["checks"].items()
                                          if v not in ("ok", "memory")),
                      "to": "/overview"})
    return {"items": items}


@router.get("/metrics", tags=["ops"])
def metrics():
    return {path: {**m, "avg_ms": round(m["ms"] / m["count"], 1) if m["count"] else 0}
            for path, m in REQUEST_METRICS.items()}


@router.get("/access/matrix", tags=["ops"])
def access_matrix(actor: Actor = Depends(require(Role.CONTENT, Role.QC, Role.SUPPORT,
                                                 Role.FINANCE, Role.ANALYST, Role.RO))):
    return {"matrix": MATRIX,
            "roles": ["admin", "content", "qc", "support", "finance", "analyst", "ro"]}


@router.get("/grievances", tags=["grievance"])
def grievances(status: str = "",
               actor: Actor = Depends(require(Role.SUPPORT))):
    if SHARED is None:
        return {"grievances": []}
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    out = []
    for g in SHARED.grievance_list(status):
        created = datetime.fromisoformat(g["created_at"])
        g["age_hours"] = round((now - created).total_seconds() / 3600, 1)
        g["ack_breach"] = g["status"] == "new" and g["age_hours"] > 24
        g["resolve_breach"] = g["status"] != "resolved" and g["age_hours"] > 15 * 24
        out.append(g)
    return {"grievances": out}


@router.post("/grievances/{gid}/ack", tags=["grievance"])
def grievance_ack(gid: str, request: Request = None,
                  actor: Actor = Depends(require(Role.SUPPORT))):
    if SHARED is None or SHARED.grievance_update(
            gid, status="ack", ack_at=now_iso(), assignee=actor.id) is None:
        raise HTTPException(status_code=404, detail="grievance not found")
    audit(actor, "grievance.ack", gid, {}, request)
    return {"id": gid, "status": "ack"}


@router.post("/grievances/{gid}/resolve", tags=["grievance"])
def grievance_resolve(gid: str, request: Request = None, body: dict = Body(default={}),
                      actor: Actor = Depends(require(Role.SUPPORT))):
    note = (body.get("note") or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="resolution requires a note")
    if SHARED is None or SHARED.grievance_update(
            gid, status="resolved", resolved_at=now_iso(),
            add_note={"by": actor.id, "at": now_iso(), "note": note}) is None:
        raise HTTPException(status_code=404, detail="grievance not found")
    audit(actor, "grievance.resolve", gid, {"note": note}, request)
    return {"id": gid, "status": "resolved"}


# ---- audit -----------------------------------------------------------------
@router.get("/audit", tags=["audit"])
def audit_log(actor: str = "", q: str = "", limit: int = 100,
              before: int | None = None,
              viewer: Actor = Depends(require(Role.FINANCE, Role.ANALYST, Role.RO))):
    """Server-filtered, paginated, hash-chain-verified audit (#066/#068/#069)."""
    limit = max(1, min(limit, 500))
    if SHARED is not None:
        return SHARED.audit_list(actor=actor, q=q, limit=limit, before_id=before)
    rows = [_audit_row(r) for r in store.audit_log()]
    if actor:
        rows = [r for r in rows if r["actor"] == actor]
    if q:
        n = q.lower()
        rows = [r for r in rows if n in r["action"].lower() or n in r["entity"].lower()
                or n in str(r["change"]).lower()]
    return {"rows": rows[-limit:][::-1], "chain_ok": True, "total": len(rows)}


app.include_router(router)

from . import oidc as _oidc  # noqa: E402  (needs `audit` + SHARED defined above)

app.include_router(_oidc.router)

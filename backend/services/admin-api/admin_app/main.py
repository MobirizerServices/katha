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
from fastapi.responses import JSONResponse
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
if os.environ.get("KATHA_PERSIST") == "1":          # pragma: no cover — import-time
    from katha_infra import SharedStore
    SHARED = SharedStore()

router = APIRouter(prefix="/admin/v1")


RATE_BUCKETS: dict = defaultdict(list)


def _rate_key(request: Request) -> str:
    from . import oidc
    ident = oidc.session_identity(request)
    if ident:
        return str(ident.get("email", "session"))
    return (request.headers.get("x-actor-id")
            or (request.client.host if request.client else "anon"))


def _ip_allowed(host: str) -> bool:
    """#084: when KATHA_ADMIN_IP_ALLOWLIST is set (comma-separated CIDRs or
    exact hosts), only those callers reach the back office. Unset = open (dev).
    VPN termination in front of this is the recommended prod posture — this is
    the in-app backstop."""
    raw = os.environ.get("KATHA_ADMIN_IP_ALLOWLIST", "").strip()
    if not raw:
        return True
    import ipaddress
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        if entry == host:
            return True
        try:
            if ipaddress.ip_address(host) in ipaddress.ip_network(entry, strict=False):
                return True
        except ValueError:
            continue
    return False


@app.middleware("http")
async def _metrics_mw(request: Request, call_next):
    t0 = time.monotonic()
    if not _ip_allowed(request.client.host if request.client else ""):
        return JSONResponse(
            {"detail": "this network is not allowed to reach the back office"},
            status_code=403)
    # Per-actor rate limit on mutations (#081): scripted abuse and stuck retry
    # loops hit a wall; normal operation never comes near it.
    if (request.method not in ("GET", "HEAD", "OPTIONS")
            and "/auth/" not in request.url.path):
        limit = int(os.environ.get("KATHA_ADMIN_RATE_LIMIT", "240"))
        key = _rate_key(request)
        now_s = time.monotonic()
        window = [t for t in RATE_BUCKETS[key] if now_s - t < 60]
        if len(window) >= limit:
            RATE_BUCKETS[key] = window
            return JSONResponse(
                {"detail": "rate limited: too many changes in a minute"},
                status_code=429)
        window.append(now_s)
        RATE_BUCKETS[key] = window
    try:
        response = await call_next(request)
        ok = response.status_code < 500
        # Security headers (#085). The dev IdP page needs its inline styles.
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if "/devidp/" not in request.url.path:
            response.headers.setdefault("Content-Security-Policy", "default-src 'none'")
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


def _rupee_rate() -> float:
    """coin→rupee rate from shared config (#023) — finance edits one number."""
    raw = SHARED.kv_get("config:coin.rupee_rate") if SHARED is not None else None
    try:
        return float(raw) if raw else 0.15
    except ValueError:
        return 0.15


def _rupees(coins: int) -> str:
    return f"₹{round(coins * _rupee_rate()):,}"


def _notify(text: str) -> bool:
    """Mirror an operational signal to a webhook (#053/#111) — Slack-compatible
    {"text": ...}. Configure KATHA_ALERT_WEBHOOK or KV config:alert.webhook;
    silently a no-op until one is set."""
    url = os.environ.get("KATHA_ALERT_WEBHOOK") or (
        SHARED.kv_get("config:alert.webhook") if SHARED is not None else None)
    if not url:
        return False
    try:
        req = urllib.request.Request(
            url, data=_json.dumps({"text": text}).encode(),
            headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=2)
        return True
    except Exception:
        return False


STEP_UP_MAX_AGE_S = int(os.environ.get("KATHA_ADMIN_STEP_UP_S", "900"))


def _step_up(request: Request) -> None:
    """Money actions demand a fresh sign-in (#079): with OIDC sessions, a
    session older than 15 minutes cannot approve/refund/erase — sign in again."""
    from . import oidc
    if oidc.auth_mode() != "oidc":
        return
    ident = oidc.session_identity(request)
    if ident is None:
        return
    if time.time() - float(ident.get("iat", 0)) > STEP_UP_MAX_AGE_S:
        raise HTTPException(
            status_code=403,
            detail="step-up required: your session is older than "
                   f"{STEP_UP_MAX_AGE_S // 60} min — sign in again to move money")


def _daily_cap_check(actor: Actor, coins: int) -> None:
    """Per-agent daily adjustment cap (#027): fifty grants of 499 now trip
    something. Counted against the requester at request time."""
    if SHARED is None:
        return
    cap = int(SHARED.kv_get("config:adjust.daily_cap") or 2000)
    key = f"adjcap:{actor.id}:{now_iso()[:10]}"
    used = int(SHARED.kv_get(key) or 0)
    if used + abs(coins) > cap:
        raise HTTPException(
            status_code=409,
            detail=f"daily adjustment cap reached: {used:,} of {cap:,} coins "
                   "already today — an admin can raise config:adjust.daily_cap")
    SHARED.kv_set(key, str(used + abs(coins)))


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
        "lastActive": u.get("last_seen") or "never",
        "flags": u.get("flags", []),
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


_LIVECOUNT_CACHE: dict = {}


def _live_count(slug: str, episode_count: int) -> int:
    """Transcoded-and-on-disk episodes (#037), cached a minute per series."""
    stamp = now_iso()[:16]
    hit = _LIVECOUNT_CACHE.get(slug)
    if hit and hit[0] == stamp:
        return hit[1]
    live = _media_health(slug, episode_count)["episodes_with_media"]
    _LIVECOUNT_CACHE[slug] = (stamp, live)
    return live


def _rights(slug: str) -> dict:
    raw = SHARED.kv_get(f"rights:{slug}") if SHARED is not None else None
    if raw:
        try:
            return _json.loads(raw)
        except ValueError:
            pass
    return {"owner": "Katha Originals", "license_until": ""}


def _admin_all_series():
    """Seed catalog + panel-drafted series (#043)."""
    from app.overrides import draft_series
    out = list(catalog.all_series())
    seen = {s.slug for s in out}
    if SHARED is not None:
        for slug in SHARED.kv_prefix("series:"):
            if slug not in seen:
                d = draft_series(slug)
                if d is not None:
                    out.append(d)
    return out


def _series_exists(slug: str) -> bool:
    if catalog.get_series(slug) is not None:
        return True
    return SHARED is not None and bool(SHARED.kv_get(f"series:{slug}"))


@router.get("/catalog/series", tags=["catalog"])
def catalog_series(actor: Actor = Depends(require(Role.CONTENT, Role.QC, Role.ANALYST, Role.RO))):
    """The catalog in the back-office client shape — real lifecycle status,
    media-derived live counts (#037), rights (#039), panel drafts (#043)."""
    out = []
    for s in _admin_all_series():
        status, _rating, touched = _series_overrides(s.slug)
        rights = _rights(s.slug)
        out.append({
            "id": s.slug, "slug": s.slug, "title": s.title, "synopsis": s.synopsis,
            "genres": s.genres, "language": _LANG_NAMES.get(s.primary_language, s.primary_language),
            "episodeCount": s.episode_count,
            "liveCount": _live_count(s.slug, s.episode_count),
            "freeEpisodes": s.free_episode_count, "coinPrice": s.episode_coin_price,
            "bundleDiscountPct": s.bundle_discount_pct,
            "status": status, "rating": s.content_rating,
            "owner": rights.get("owner") or "Katha Originals",
            "licenseUntil": rights.get("license_until", ""),
            "updatedAt": touched or 0,
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
    out = []
    for k in DEFAULT_FLAGS:
        o = overrides.get(k)
        if isinstance(o, dict):
            enabled, pct = bool(o.get("enabled")), int(o.get("pct", 100))
        elif isinstance(o, bool):
            enabled, pct = o, 100
        else:
            enabled, pct = DEFAULT_FLAGS[k]["enabled"], 100
        out.append(
            {"key": k, "description": DEFAULT_FLAGS[k]["description"],
             "enabled": enabled, "pct": pct, "env": "prod",
             "guarded": bool(DEFAULT_FLAGS[k].get("guarded")),
             "owner": DEFAULT_FLAGS[k].get("owner", ""),
             "review_by": DEFAULT_FLAGS[k].get("review_by", "")})
    return out


@router.patch("/config/flags/{key}", tags=["config"])
def set_flag(key: str, request: Request = None, body: dict = Body(...),
             actor: Actor = Depends(require(Role.CONTENT))):
    """Flip a flag. Persists to the shared DB, so core-api's /v1/config serves
    the new value on its very next request. Audited like every mutation."""
    if key not in DEFAULT_FLAGS:
        raise HTTPException(status_code=404, detail="unknown flag")
    enabled = bool(body.get("enabled"))
    pct = int(body.get("pct", 100))
    if not (0 <= pct <= 100):
        raise HTTPException(status_code=400, detail="pct must be 0-100")
    if DEFAULT_FLAGS[key].get("guarded") and body.get("confirm") != key:
        raise HTTPException(status_code=428,
                            detail=f"guarded flag: repeat the key '{key}' as confirm")
    overrides = SHARED.flag_overrides() if SHARED is not None else {
        k: v for k, v in store.flag_overrides.items()
        if isinstance(v, (bool, dict))}
    cur = overrides.get(key)
    if isinstance(cur, dict):
        current = (bool(cur.get("enabled")), int(cur.get("pct", 100)))
    elif isinstance(cur, bool):
        current = (cur, 100)
    else:
        current = (DEFAULT_FLAGS[key]["enabled"], 100)
    if current == (enabled, pct):                # no-op writes are not audited
        return {"key": key, "enabled": enabled, "pct": pct}
    if SHARED is not None:
        SHARED.set_flag(key, enabled, pct)
    else:
        store.flag_overrides[key] = (
            enabled if pct >= 100 else {"enabled": enabled, "pct": pct})
    audit(actor, "config.flag.set", key,
          {"from": f"{current[0]}@{current[1]}%", "to": f"{enabled}@{pct}%"},
          request)
    return {"key": key, "enabled": enabled, "pct": pct}


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

    _daily_cap_check(actor, coins)

    # Above the threshold: do NOT apply — queue a pending approval for a 2nd actor.
    if abs(coins) > DUAL_APPROVAL_THRESHOLD:
        ap = store.create_approval(actor, user_id, coins, reason_code, note)
        audit(actor, "wallet.adjust.requested", user_id,
              {"approval_id": ap.id, "coins": coins, "reason_code": reason_code}, request)
        _notify(f"[katha-admin] approval {ap.id}: {coins:+,} coins for {user_id} "
                f"requested by {actor.id} — needs a second person")
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
    _step_up(request)
    ap = store.approvals.get(approval_id)
    if ap is None:
        raise HTTPException(status_code=404, detail="approval not found")
    if ap.status != "pending":
        # A rejected approval is a veto, not a pause — it must never apply.
        raise HTTPException(status_code=409, detail=f"already {ap.status}")
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
    _step_up(request)
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
    _step_up(request)
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
    from app.overrides import get_series
    d = get_series(slug)          # seed or panel draft, panel pricing applied
    if d is None:
        raise HTTPException(status_code=404, detail="series not found")
    status, rating, touched = _series_overrides(slug)
    base = _media_root() / slug
    pricing_over = bool(SHARED and SHARED.kv_get(f"price:{slug}"))
    return {
        "slug": d.slug, "title": d.title, "synopsis": d.synopsis,
        "genres": d.genres, "language": _LANG_NAMES.get(d.primary_language,
                                                        d.primary_language),
        "episodeCount": d.episode_count, "freeEpisodes": d.free_episode_count,
        "coinPrice": d.episode_coin_price, "bundleDiscountPct": d.bundle_discount_pct,
        "pricingOverridden": pricing_over,
        "status": status,
        "rating": rating.get("value") or d.content_rating,
        "ratingHistory": rating, "updatedAt": touched,
        "rights": _rights(slug),
        "coverUrl": f"{catalog.media_base()}/media/{slug}/cover_9x16.jpg",
        "media": _media_health(slug, d.episode_count),
        "episodes": [{"number": e.number, "title": e.title, "isFree": e.is_free,
                      "hasMedia": (base / f"e{e.number:03d}" / "hls"
                                   / "master.m3u8").is_file()}
                     for e in d.episodes],
        "previewWeb": f"http://localhost:3000/watch/{slug}/1",
    }


@router.post("/catalog/series/{slug}/status", tags=["catalog"])
def set_series_status(slug: str, request: Request = None, body: dict = Body(...),
                      actor: Actor = Depends(require(Role.CONTENT, Role.QC))):
    """Lifecycle control: live | scheduled | draft | archived. Archived/draft
    series disappear from the public catalog on core-api's next request
    (admin review #035/#046). QC may only take DOWN (archive)."""
    if not _series_exists(slug):
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
    if not _series_exists(slug):
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
        "coin_rupee_rate": _rupee_rate(),
        "adjust_daily_cap": int((SHARED.kv_get("config:adjust.daily_cap")
                                 if SHARED is not None else None) or 2000),
        "pricing": prof,
        "min_app_version": (SHARED.kv_get("config:app.min_version")
                            if SHARED is not None else None) or "1.0.0",
        "retention": {
            "money_ledger": "append-only, kept 7 years (finance/GST)",
            "audit_log": "hash-chained, never edited; legal hold via export",
            "events_days": 365,
        },
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
    service health, license expiry, adjustment-cap usage. Each item has a
    stable id and can be acknowledged (#016); new danger items mirror to the
    alert webhook once (#111)."""
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
    if SHARED is not None:
        from datetime import date, timedelta
        # Licensed content expiring inside 30 days (#039)
        soon = (date.fromisoformat(now_iso()[:10]) + timedelta(days=30)).isoformat()
        for slug, raw in SHARED.kv_prefix("rights:").items():
            try:
                r = _json.loads(raw)
            except ValueError:
                continue
            until = r.get("license_until", "")
            if until and until <= soon:
                items.append({"id": f"license:{slug}", "severity": "warn",
                              "title": f"Licence for {slug} ends {until}",
                              "detail": f"owner: {r.get('owner', '?')} — renew or archive",
                              "to": f"/catalog/{slug}"})
        # An agent near their daily adjustment cap (#027)
        cap = int(SHARED.kv_get("config:adjust.daily_cap") or 2000)
        day = now_iso()[:10]
        for suffix, used in SHARED.kv_prefix("adjcap:").items():
            who, _, d = suffix.rpartition(":")
            if d == day and int(used) >= cap * 8 // 10:
                items.append({"id": f"cap:{who}", "severity": "warn",
                              "title": f"{who} at {int(used):,}/{cap:,} of the daily adjust cap",
                              "detail": "Unusual grant volume — worth a look.",
                              "to": "/audit"})
        # Acknowledgement state (#016) + one-shot webhook mirror (#111)
        for it in items:
            raw = SHARED.kv_get(f"attnack:{it['id']}")
            if raw:
                try:
                    it["ack"] = _json.loads(raw)
                except ValueError:
                    pass
            if it["severity"] == "danger" and "ack" not in it and \
                    not SHARED.kv_get(f"alerted:{it['id']}"):
                if _notify(f"[katha-admin] {it['title']} — {it['detail']}"):
                    SHARED.kv_set(f"alerted:{it['id']}", now_iso())
    return {"items": items}


@router.get("/metrics", tags=["ops"])
def metrics():
    out = {path: {**m, "avg_ms": round(m["ms"] / m["count"], 1) if m["count"] else 0}
           for path, m in REQUEST_METRICS.items()}
    out["ui"] = dict(UI_METRICS)   # which views operators actually open (#112)
    return out


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
    _grievance_email(gid, "acknowledged",
                     "We have received your grievance and a named officer is "
                     "reviewing it. You will hear back within 15 days.")
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
    _grievance_email(gid, "resolved", note)
    return {"id": gid, "status": "resolved"}


# ---- audit -----------------------------------------------------------------
@router.get("/audit", tags=["audit"])
def audit_log(actor: str = "", q: str = "", limit: int = 100,
              before: int | None = None,
              viewer: Actor = Depends(require(Role.FINANCE, Role.ANALYST, Role.RO))):
    """Server-filtered, paginated, hash-chain-verified audit (#066/#068/#069).
    Rows may carry an annotation (#070) — a note laid BESIDE the chain, never
    an edit: superseded/no-op rows get explained, not rewritten."""
    limit = max(1, min(limit, 500))
    if SHARED is not None:
        out = SHARED.audit_list(actor=actor, q=q, limit=limit, before_id=before)
        notes = SHARED.kv_prefix("auditnote:")
        for r in out["rows"]:
            raw = notes.get(str(r["id"]))
            if raw:
                try:
                    r["note"] = _json.loads(raw)
                except ValueError:
                    pass
        return out
    rows = [_audit_row(r) for r in store.audit_log()]
    if actor:
        rows = [r for r in rows if r["actor"] == actor]
    if q:
        n = q.lower()
        rows = [r for r in rows if n in r["action"].lower() or n in r["entity"].lower()
                or n in str(r["change"]).lower()]
    return {"rows": rows[-limit:][::-1], "chain_ok": True, "total": len(rows)}




# ---- attention acknowledgement (#016) ---------------------------------------
@router.post("/attention/{item_id}/ack", tags=["ops"])
def attention_ack(item_id: str, request: Request = None,
                  actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE,
                                                 Role.CONTENT, Role.ANALYST))):
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    SHARED.kv_set(f"attnack:{item_id}",
                  _json.dumps({"by": actor.id, "at": now_iso()}))
    audit(actor, "attention.ack", item_id, {}, request)
    return {"id": item_id, "ack": {"by": actor.id, "at": now_iso()}}


# ---- the analytics rollup (#009-#015) ---------------------------------------
@router.get("/analytics", tags=["overview"])
def analytics(actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE,
                                             Role.ANALYST, Role.RO, Role.CONTENT))):
    """Windowed KPIs with deltas (#009), revenue split by channel (#010), the
    paywall→purchase→unlock funnel (#013), refund ratio (#014), the coin
    liability trend + breakage (#012), and 30-day sparklines (#015)."""
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    a = SHARED.analytics(now=now_iso(), days=60)
    daily = a["daily"]
    rate = _rupee_rate()

    def window(rows: list[dict]) -> dict:
        purchased = sum(r["coins_purchased"] for r in rows)
        refunded = sum(r["coins_refunded"] for r in rows)
        return {
            "coins_purchased": purchased,
            "revenue_rupees": round(purchased * rate),
            "coins_iap": sum(r["coins_iap"] for r in rows),
            "coins_web": sum(r["coins_web"] for r in rows),
            "unlocks": sum(r["unlocks"] for r in rows),
            "dau_peak": max((r["dau"] for r in rows), default=0),
            "new_users": sum(r["new_users"] for r in rows),
            "watch_minutes": sum(r["watch_minutes"] for r in rows),
            "coins_refunded": refunded,
            "refund_ratio_pct": round(refunded * 100 / purchased, 2) if purchased else 0.0,
        }

    windows = {}
    for name, n in (("today", 1), ("7d", 7), ("30d", 30)):
        cur, prev = window(daily[-n:]), window(daily[-2 * n:-n])
        windows[name] = {"current": cur, "previous": prev}
    spark = {k: [r[k] for r in daily[-30:]]
             for k in ("coins_purchased", "unlocks", "dau", "new_users",
                       "watch_minutes", "paywall_views")}
    return {
        "windows": windows,
        "funnel": a["funnel"],
        "days": a["days"][-30:],
        "spark": spark,
        "outstanding_trend": a["outstanding_trend"][-30:],
        "outstanding_rupees": round(a["outstanding_trend"][-1] * rate)
                              if a["outstanding_trend"] else 0,
        "breakage_dormant_coins": a["breakage_dormant_coins"],
        "coin_rupee_rate": rate,
        "generated_at": now_iso(),
    }


# ---- per-series pricing (#040), episode edits (#034), rights (#039) --------
@router.patch("/catalog/series/{slug}/pricing", tags=["catalog"])
def set_series_pricing(slug: str, request: Request = None, body: dict = Body(...),
                       actor: Actor = Depends(require(Role.FINANCE))):
    """Per-series price/free-window override reaching playback AND the ledger
    charge on core-api's next request. Guarded by a typed confirm."""
    if not _series_exists(slug):
        raise HTTPException(status_code=404, detail="series not found")
    if body.get("confirm") != slug:
        raise HTTPException(status_code=428, detail="type the slug to confirm")
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    fields = {}
    if "coin_price" in body:
        fields["coin_price"] = int(body["coin_price"])
        if not (1 <= fields["coin_price"] <= 1000):
            raise HTTPException(status_code=400, detail="coin_price must be 1-1000")
    if "free_episodes" in body:
        fields["free_episodes"] = int(body["free_episodes"])
        if not (0 <= fields["free_episodes"] <= 100):
            raise HTTPException(status_code=400, detail="free_episodes must be 0-100")
    if not fields:
        raise HTTPException(status_code=400, detail="nothing to change")
    SHARED.kv_set(f"price:{slug}", _json.dumps(fields))
    SHARED.kv_set(f"touched:{slug}", now_iso())
    audit(actor, "series.pricing", slug, fields, request)
    return {"slug": slug, **fields}


@router.patch("/catalog/series/{slug}/episodes/{number}", tags=["catalog"])
def set_episode(slug: str, number: int, request: Request = None,
                body: dict = Body(...),
                actor: Actor = Depends(require(Role.CONTENT))):
    """Episode-level management (#034): retitle without touching the seed file."""
    if not _series_exists(slug):
        raise HTTPException(status_code=404, detail="series not found")
    title = (body.get("title") or "").strip()
    if not title or len(title) > 120:
        raise HTTPException(status_code=400, detail="title must be 1-120 chars")
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    SHARED.kv_set(f"ep:{slug}:{number}", _json.dumps({"title": title}))
    SHARED.kv_set(f"touched:{slug}", now_iso())
    audit(actor, "series.episode", f"{slug}:e{number}", {"title": title}, request)
    return {"slug": slug, "number": number, "title": title}


@router.patch("/catalog/series/{slug}/rights", tags=["catalog"])
def set_series_rights(slug: str, request: Request = None, body: dict = Body(...),
                      actor: Actor = Depends(require(Role.CONTENT))):
    """Ownership + licence window (#039); expiring licences hit the attention
    rail 30 days out."""
    if not _series_exists(slug):
        raise HTTPException(status_code=404, detail="series not found")
    owner = (body.get("owner") or "").strip() or "Katha Originals"
    until = (body.get("license_until") or "").strip()
    if until:
        from datetime import date
        try:
            date.fromisoformat(until)
        except ValueError:
            raise HTTPException(status_code=400, detail="license_until must be YYYY-MM-DD")
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    SHARED.kv_set(f"rights:{slug}", _json.dumps({"owner": owner,
                                                 "license_until": until}))
    audit(actor, "series.rights", slug, {"owner": owner, "until": until}, request)
    return {"slug": slug, "owner": owner, "license_until": until}


@router.post("/catalog/series", tags=["catalog"])
def create_series(request: Request = None, body: dict = Body(...),
                  actor: Actor = Depends(require(Role.CONTENT))):
    """Draft a series in the panel (#043) — metadata first, media later. It
    reaches the public catalog only when its status is flipped to live."""
    import re as _re
    slug = (body.get("slug") or "").strip().lower()
    title = (body.get("title") or "").strip()
    if not _re.fullmatch(r"[a-z0-9][a-z0-9-]{2,39}", slug):
        raise HTTPException(status_code=400,
                            detail="slug: 3-40 chars, a-z 0-9 and hyphens")
    if not title:
        raise HTTPException(status_code=400, detail="title required")
    count = int(body.get("episode_count") or 0)
    if not (1 <= count <= 200):
        raise HTTPException(status_code=400, detail="episode_count must be 1-200")
    if _series_exists(slug):
        raise HTTPException(status_code=409, detail="slug already exists")
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    draft = {
        "title": title, "language": (body.get("language") or "hi"),
        "genres": body.get("genres") or [], "synopsis": (body.get("synopsis") or ""),
        "episode_count": count,
        "coin_price": int(body.get("coin_price") or catalog.pricing()["episode_coin_price"]),
        "free_episodes": int(body.get("free_episodes")
                             if body.get("free_episodes") is not None
                             else catalog.pricing()["free_episode_count"]),
        "rating": body.get("rating") or "U/A 13+",
        "created_by": actor.id, "created_at": now_iso(),
    }
    SHARED.kv_set(f"series:{slug}", _json.dumps(draft))
    SHARED.kv_set(f"status:{slug}", "draft")
    SHARED.kv_set(f"touched:{slug}", now_iso())
    audit(actor, "series.create", slug,
          {"title": title, "episodes": count}, request)
    return {"slug": slug, "status": "draft", **draft}


# ---- experiment registry (#061) ---------------------------------------------
@router.get("/experiments", tags=["config"])
def experiments(actor: Actor = Depends(require(Role.CONTENT, Role.FINANCE,
                                               Role.ANALYST, Role.RO))):
    if SHARED is None:
        return {"experiments": []}
    out = []
    for key, raw in sorted(SHARED.kv_prefix("exp:").items()):
        try:
            out.append({"key": key, **_json.loads(raw)})
        except ValueError:
            continue
    return {"experiments": out}


@router.put("/experiments/{key}", tags=["config"])
def set_experiment(key: str, request: Request = None, body: dict = Body(...),
                   actor: Actor = Depends(require(Role.CONTENT))):
    """Thin experiment registry (#061): variants with % splits, assigned by a
    stable user hash and served to clients in /v1/config.experiments."""
    import re as _re
    if not _re.fullmatch(r"[a-z0-9][a-z0-9_.-]{2,39}", key):
        raise HTTPException(status_code=400, detail="bad experiment key")
    status = (body.get("status") or "draft").strip()
    if status not in ("draft", "running", "stopped"):
        raise HTTPException(status_code=400, detail="status: draft|running|stopped")
    variants = body.get("variants") or []
    total = 0
    for v in variants:
        pct = int(v.get("pct", 0))
        if pct < 0 or not (v.get("name") or "").strip():
            raise HTTPException(status_code=400, detail="each variant needs name + pct>=0")
        total += pct
    if total > 100:
        raise HTTPException(status_code=400, detail="variant pcts exceed 100")
    if status == "running" and not variants:
        raise HTTPException(status_code=400, detail="running needs variants")
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    record = {"hypothesis": (body.get("hypothesis") or "").strip(),
              "variants": [{"name": v["name"].strip(), "pct": int(v.get("pct", 0))}
                           for v in variants],
              "status": status, "by": actor.id, "at": now_iso()}
    SHARED.kv_set(f"exp:{key}", _json.dumps(record))
    audit(actor, "experiment.set", key,
          {"status": status, "variants": len(variants)}, request)
    return {"key": key, **record}


# ---- devices + sign-out-everywhere (#021) -----------------------------------
@router.get("/users/{user_id}/devices", tags=["users"])
def user_devices(user_id: str,
                 actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE,
                                                Role.ANALYST))):
    if SHARED is None:
        return {"user_id": user_id, "devices": []}
    return {"user_id": user_id, "devices": SHARED.devices(user_id)}


@router.post("/users/{user_id}/signout-devices", tags=["users"])
def user_signout_devices(user_id: str, request: Request = None,
                         actor: Actor = Depends(require(Role.SUPPORT))):
    """Account-takeover response (#021): bump the token version so every JWT
    issued before now stops validating on core-api's next request."""
    _step_up(request)
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    ver = SHARED.bump_token_version(user_id)
    if ver == 0:
        raise HTTPException(status_code=404, detail="unknown user")
    audit(actor, "user.signout_all", user_id, {"token_version": ver}, request)
    return {"user_id": user_id, "token_version": ver}


# ---- which views operators actually use (#112) ------------------------------
UI_METRICS: dict = defaultdict(int)


@router.post("/metrics/ui", tags=["ops"])
def ui_ping(body: dict = Body(...),
            actor: Actor = Depends(require(Role.CONTENT, Role.QC, Role.SUPPORT,
                                           Role.FINANCE, Role.ANALYST, Role.RO))):
    view = str(body.get("view", ""))[:40]
    if view:
        UI_METRICS[view] += 1
    return {"ok": True}




# ---- audit annotations (#070): explain, never edit --------------------------
@router.patch("/audit/{row_id}/note", tags=["ops"])
def audit_annotate(row_id: int, request: Request = None, body: dict = Body(...),
                   actor: Actor = Depends(require())):
    """Attach a note to an audit row (e.g. "superseded by #58 — double-fire
    era", "no-op"). The chain is untouched; the annotation itself is audited."""
    note = (body.get("note") or "").strip()
    if not note or len(note) > 300:
        raise HTTPException(status_code=400, detail="note must be 1-300 chars")
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    if not any(r["id"] == row_id
               for r in SHARED.audit_list(limit=500)["rows"]):
        raise HTTPException(status_code=404, detail="no such audit row")
    record = {"note": note, "by": actor.id, "at": now_iso()}
    SHARED.kv_set(f"auditnote:{row_id}", _json.dumps(record))
    audit(actor, "audit.note", str(row_id), {"note": note}, request)
    return {"id": row_id, "note": record}



# ---- outbound comms: outbox ledger, drop pushes, grievance emails -----------
def _grievance_email(gid: str, verdict: str, message: str) -> None:
    """Email the complainant on ack/resolve (IT Rules communication trail)."""
    if SHARED is None:
        return
    from katha_infra import comms
    g = next((x for x in SHARED.grievance_list() if x["id"] == gid), None)
    if g is None or "@" not in g["contact"]:
        return
    comms.send_email(
        SHARED, to=g["contact"],
        subject=f"Your Katha grievance {gid} — {verdict}",
        body_html=(f"<p>Grievance <b>{gid}</b> ({g['subject']}) has been "
                   f"<b>{verdict}</b>.</p><p>{message}</p>"
                   "<p>— Katha grievance desk</p>"),
        now=now_iso())


@router.get("/invoices", tags=["ops"])
def invoices(actor: Actor = Depends(require(Role.FINANCE, Role.ANALYST, Role.RO))):
    """The GST invoice register (web/UPI sales) — what finance files from."""
    if SHARED is None:
        return {"rows": [], "totals": {"count": 0, "gross_minor": 0, "gst_minor": 0}}
    rows = SHARED.invoices_all()
    return {"rows": rows,
            "totals": {"count": len(rows),
                       "gross_minor": sum(r["total_minor"] for r in rows),
                       "gst_minor": sum(r["gst_minor"] for r in rows)}}


@router.get("/outbox", tags=["ops"])
def outbox(kind: str = "", limit: int = 100,
           actor: Actor = Depends(require(Role.SUPPORT, Role.FINANCE,
                                          Role.ANALYST, Role.RO))):
    """Every email and push the system produced — queued (dev, no transport
    configured), sent, or failed with the reason. The truth about comms."""
    if SHARED is None:
        return {"rows": [], "transports": {"email": False, "push": False}}
    from katha_infra import comms
    return {"rows": SHARED.outbox_list(kind=kind, limit=max(1, min(limit, 500))),
            "transports": {"email": comms.email_configured(),
                           "push": comms.push_configured()}}


@router.post("/outbox/{row_id}/retry", tags=["ops"])
def outbox_retry(row_id: int, request: Request,
                 actor: Actor = Depends(require(Role.SUPPORT))):
    """Re-attempt a queued/failed email. Push rows can't be retried here —
    the outbox keeps only a truncated device token; re-send the drop from
    the catalog instead."""
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    from katha_infra import comms
    row = SHARED.outbox_get(row_id)
    if row is None:
        raise HTTPException(status_code=404, detail="no such outbox row")
    if row["kind"] != "email":
        raise HTTPException(status_code=409,
                            detail="only email rows retry from the outbox — "
                                   "re-send pushes from the catalog's Notify drop")
    if row["status"] == "sent":
        raise HTTPException(status_code=409, detail="already sent")
    if not comms.email_configured():
        raise HTTPException(status_code=409,
                            detail="no SMTP transport configured (KATHA_SMTP_URL)")
    sent, detail = comms.retry_email(SHARED, row)
    audit(actor, "outbox.retry", str(row_id),
          {"outcome": "sent" if sent else "failed", "detail": detail}, request)
    return {"id": row_id, "status": "sent" if sent else "failed", "detail": detail}


@router.get("/invoices.csv", tags=["ops"])
def invoices_csv(actor: Actor = Depends(require(Role.FINANCE, Role.ANALYST,
                                                Role.RO))):
    """The register as CSV — what actually gets attached to the GST filing."""
    import csv
    import io
    from fastapi.responses import PlainTextResponse
    rows = SHARED.invoices_all() if SHARED is not None else []
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["invoice_no", "date", "buyer", "sku", "coins", "bonus_coins",
                "taxable_minor", "gst_minor", "total_minor", "gst_rate_pct",
                "seller_gstin"])
    for r in rows:
        w.writerow([r["id"], r["created_at"][:10], r["user_id"], r["sku"],
                    r["coins"], r["bonus_coins"], r["taxable_minor"],
                    r["gst_minor"], r["total_minor"], r["gst_rate_pct"],
                    r["seller_gstin"]])
    return PlainTextResponse(
        buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition":
                 'attachment; filename="katha-invoices.csv"'})


@router.post("/catalog/series/{slug}/notify-drop", tags=["catalog"])
def notify_drop(slug: str, request: Request = None, body: dict = Body(...),
                actor: Actor = Depends(require(Role.CONTENT))):
    """Episode-drop push to every registered device (PDD §14). Outbox-first;
    APNs delivers when KATHA_APNS_* is configured."""
    if not _series_exists(slug):
        raise HTTPException(status_code=404, detail="series not found")
    episode = int(body.get("episode") or 0)
    if episode < 1:
        raise HTTPException(status_code=400, detail="episode required")
    if SHARED is None:
        raise HTTPException(status_code=503, detail="needs persistence")
    from app.overrides import get_series
    from katha_infra import comms
    series = get_series(slug)
    title = series.title if series else slug
    tokens = SHARED.push_tokens()
    for t in tokens:
        comms.send_push(SHARED, device_token=t["token"], title=title,
                        body=f"Episode {episode} just dropped — continue the story.",
                        route={"slug": slug, "episode": episode}, now=now_iso())
    audit(actor, "series.notify_drop", slug,
          {"episode": episode, "devices": len(tokens)}, request)
    return {"slug": slug, "episode": episode, "devices": len(tokens)}

app.include_router(router)

from . import oidc as _oidc  # noqa: E402  (needs `audit` + SHARED defined above)

app.include_router(_oidc.router)

# Fail-closed config guard (see katha_infra.prodguard). No-op in dev/test.
try:
    from katha_infra import enforce_production_config
    from katha_infra import observability
    observability.init("admin-api")
    enforce_production_config("admin-api")
except ImportError:
    pass

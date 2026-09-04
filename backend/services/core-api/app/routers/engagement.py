"""Engagement: watch progress, continue-watching, My List, daily check-in reward."""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from katha_domain import catalog
from katha_domain.schemas import (
    CheckinResponse,
    ContinueItem,
    ContinueResponse,
    MyListResponse,
    ProgressBatchBody,
    RemindersResponse,
    WalletResponse,
)
from katha_ledger import TxType
from ..auth import current_user
from katha_domain.timeutil import ist_day, now_iso

from ..store import CHECKIN_COINS, store

router = APIRouter(prefix="/v1", tags=["engagement"])


def _wallet(user: str) -> WalletResponse:
    w = store.ledger.balance(user)
    return WalletResponse(balance_bought=w.balance_bought, balance_bonus=w.balance_bonus, total=w.total)


@router.put("/progress", response_model=ContinueResponse)
def put_progress(body: ProgressBatchBody, user: str = Depends(current_user)) -> ContinueResponse:
    """Batch upload of watch progress (the client flushes periodically)."""
    from ..overrides import get_series, is_served
    for it in body.items:
        series = get_series(it.slug) if is_served(it.slug) else None
        if series is None or not (1 <= it.number <= series.episode_count):
            raise HTTPException(status_code=404, detail=f"episode not found: {it.slug} e{it.number}")
        eid = catalog.episode_id(it.slug, it.number)
        delta = store.progress_delta(user, eid, it.position_ms)
        store.record_progress(user, it.slug, it.number, it.position_ms, it.duration_ms,
                              rewind=it.rewind)
        if delta > 0:
            store.emit(user, "play_progress", ref=eid, value=delta)
    return _continue(user)


@router.get("/me/continue", response_model=ContinueResponse)
def get_continue(limit: int = Query(20, ge=1, le=100),
                 user: str = Depends(current_user)) -> ContinueResponse:
    """Continue watching, most recent first. `limit` sizes the rail (20) or the
    full-list screen (up to 100)."""
    return _continue(user, limit=limit)


def _continue(user: str, *, limit: int = 20) -> ContinueResponse:
    from ..overrides import get_series
    items: list[ContinueItem] = []
    for p in store.continue_watching(user)[:limit]:
        series = get_series(p.slug)
        title = series.title if series else p.slug
        ep = series.episodes[p.number - 1] if series and 0 < p.number <= len(series.episodes) else None
        percent = int(p.position_ms * 100 / p.duration_ms) if p.duration_ms else 0
        items.append(ContinueItem(
            slug=p.slug, number=p.number, episode_id=p.episode_id,
            position_ms=p.position_ms, duration_ms=p.duration_ms,
            title=title, percent=percent, series_title=title,
            episode_title=ep.title if ep else "",
            cover_url=series.cover_url if series else "",
            cover_wide_url=series.cover_wide_url if series else "",
            updated_at=p.updated_at,
        ))
    return ContinueResponse(items=items)


@router.get("/me/list", response_model=MyListResponse)
def get_list(user: str = Depends(current_user)) -> MyListResponse:
    return _list_response(user)


@router.put("/me/list/{slug}", response_model=MyListResponse)
def add_list(slug: str, user: str = Depends(current_user)) -> MyListResponse:
    from ..overrides import get_series, is_served
    if not is_served(slug) or get_series(slug) is None:
        raise HTTPException(status_code=404, detail="series not found")
    store.add_to_list(user, slug)
    return _list_response(user)


@router.delete("/me/list/{slug}", response_model=MyListResponse)
def remove_list(slug: str, user: str = Depends(current_user)) -> MyListResponse:
    store.remove_from_list(user, slug)
    return _list_response(user)


def _list_response(user: str) -> MyListResponse:
    slugs = store.my_list(user)
    summaries = {s.slug: s for s in catalog.summaries()}
    series = [summaries[s] for s in slugs if s in summaries]
    return MyListResponse(slugs=slugs, series=series)


# ---- reminders: "remind me when a new episode drops" -----------------------
@router.get("/me/reminders", response_model=RemindersResponse)
def get_reminders(user: str = Depends(current_user)) -> RemindersResponse:
    return RemindersResponse(slugs=store.reminders(user))


@router.put("/me/reminders/{slug}", response_model=RemindersResponse)
def add_reminder(slug: str, user: str = Depends(current_user)) -> RemindersResponse:
    from ..overrides import get_series, is_served
    if not is_served(slug) or get_series(slug) is None:
        raise HTTPException(status_code=404, detail="series not found")
    store.add_reminder(user, slug)
    store.emit(user, "reminder_set", ref=slug)
    return RemindersResponse(slugs=store.reminders(user))


@router.delete("/me/reminders/{slug}", response_model=RemindersResponse)
def remove_reminder(slug: str, user: str = Depends(current_user)) -> RemindersResponse:
    store.remove_reminder(user, slug)
    return RemindersResponse(slugs=store.reminders(user))


@router.post("/rewards/checkin", response_model=CheckinResponse)
def checkin(user: str = Depends(current_user)) -> CheckinResponse:
    """Daily check-in: +5 bonus coins, idempotent per day via the ledger key."""
    key = f"checkin:{user}:{ist_day()}"
    before = store.ledger.balance(user).total
    store.ledger.credit(user, TxType.CHECKIN, coins=CHECKIN_COINS, reference_type="day",
                        reference_id=ist_day(), idempotency_key=key, created_at=now_iso())
    after = store.ledger.balance(user).total
    already = after == before
    if not already:
        store.emit(user, "checkin", ref=ist_day(), value=CHECKIN_COINS)
    return CheckinResponse(
        granted_coins=0 if already else CHECKIN_COINS,
        already_claimed=already, day=ist_day(), wallet=_wallet(user),
    )


# ---- grievance intake (IT Rules; back office triages — admin review #073) ----
from pydantic import BaseModel as _BM


class GrievanceIn(_BM):
    contact: str
    subject: str
    body: str = ""
    channel: str = "app"


@router.post("/push/register")
def push_register(body: dict = Body(...), user: str = Depends(current_user)) -> dict:
    """APNs device-token registration — the server can then reach this
    device for episode drops. Tokens are per (user, device), idempotent."""
    token = (body.get("token") or "").strip()
    if not token or len(token) > 200:
        raise HTTPException(status_code=400, detail="bad device token")
    if store.shared is None:
        raise HTTPException(status_code=503, detail="push registry needs persistence")
    store.shared.push_register(user, token=token,
                               platform=(body.get("platform") or "ios"),
                               now=now_iso())
    return {"registered": True}


@router.get("/me/invoices")
def my_invoices(user: str = Depends(current_user)) -> dict:
    """Invoices for this account's WEB purchases (buy on web, see in-app)."""
    if store.shared is None:
        return {"invoices": []}
    return {"invoices": store.shared.invoices_for(user)}


@router.post("/grievance")
def file_grievance(g: GrievanceIn, user: str = Depends(current_user)) -> dict:
    from uuid import uuid4

    from katha_domain.timeutil import now_iso
    if store.shared is None:
        raise HTTPException(status_code=503, detail="grievance intake needs persistence")
    if not g.contact.strip() or not g.subject.strip():
        raise HTTPException(status_code=400, detail="contact and subject are required")
    gid = f"G-{uuid4().hex[:6].upper()}"
    store.shared.grievance_create(gid=gid, user_id=user, contact=g.contact.strip(),
                                  channel=g.channel, subject=g.subject.strip(),
                                  body=g.body.strip(), created_at=now_iso())
    store.emit(user, "grievance", ref=gid)
    return {"id": gid, "status": "new",
            "promise": "acknowledged within 24 hours, resolved within 15 days"}

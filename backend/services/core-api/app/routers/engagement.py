"""Engagement: watch progress, continue-watching, My List, daily check-in reward."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from katha_domain import catalog
from katha_domain.schemas import (
    CheckinResponse,
    ContinueItem,
    ContinueResponse,
    MyListResponse,
    ProgressBatchBody,
    WalletResponse,
)
from katha_ledger import TxType
from ..auth import current_user
from ..store import CHECKIN_COINS, CLOCK, CLOCK_DAY, store

router = APIRouter(prefix="/v1", tags=["engagement"])


def _wallet(user: str) -> WalletResponse:
    w = store.ledger.balance(user)
    return WalletResponse(balance_bought=w.balance_bought, balance_bonus=w.balance_bonus, total=w.total)


@router.put("/progress", response_model=ContinueResponse)
def put_progress(body: ProgressBatchBody, user: str = Depends(current_user)) -> ContinueResponse:
    """Batch upload of watch progress (the client flushes periodically)."""
    for it in body.items:
        series = catalog.get_series(it.slug)
        if series is None or not (1 <= it.number <= series.episode_count):
            raise HTTPException(status_code=404, detail=f"episode not found: {it.slug} e{it.number}")
        store.record_progress(user, it.slug, it.number, it.position_ms, it.duration_ms)
    return _continue(user)


@router.get("/me/continue", response_model=ContinueResponse)
def get_continue(user: str = Depends(current_user)) -> ContinueResponse:
    return _continue(user)


def _continue(user: str) -> ContinueResponse:
    items: list[ContinueItem] = []
    for p in store.continue_watching(user):
        series = catalog.get_series(p.slug)
        title = series.title if series else p.slug
        percent = int(p.position_ms * 100 / p.duration_ms) if p.duration_ms else 0
        items.append(ContinueItem(
            slug=p.slug, number=p.number, episode_id=p.episode_id,
            position_ms=p.position_ms, duration_ms=p.duration_ms,
            title=title, percent=percent,
        ))
    return ContinueResponse(items=items)


@router.get("/me/list", response_model=MyListResponse)
def get_list(user: str = Depends(current_user)) -> MyListResponse:
    return _list_response(user)


@router.put("/me/list/{slug}", response_model=MyListResponse)
def add_list(slug: str, user: str = Depends(current_user)) -> MyListResponse:
    if catalog.get_series(slug) is None:
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


@router.post("/rewards/checkin", response_model=CheckinResponse)
def checkin(user: str = Depends(current_user)) -> CheckinResponse:
    """Daily check-in: +5 bonus coins, idempotent per day via the ledger key."""
    key = f"checkin:{user}:{CLOCK_DAY}"
    before = store.ledger.balance(user).total
    store.ledger.credit(user, TxType.CHECKIN, coins=CHECKIN_COINS, reference_type="day",
                        reference_id=CLOCK_DAY, idempotency_key=key, created_at=CLOCK)
    after = store.ledger.balance(user).total
    already = after == before
    return CheckinResponse(
        granted_coins=0 if already else CHECKIN_COINS,
        already_claimed=already, day=CLOCK_DAY, wallet=_wallet(user),
    )

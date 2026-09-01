"""Wallet, IAP verify, web orders, and unlock — all money mutations go through the ledger."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from katha_domain import catalog
from katha_domain.schemas import (
    CoinPack,
    IapVerifyRequest,
    UnlockRequest,
    UnlockResponse,
    WalletResponse,
    WebOrderRequest,
)
from katha_ledger import InsufficientCoins, TxType
from ..deps import current_user
from ..store import CLOCK, PACKS, WEB_BONUS_PCT, store

router = APIRouter(prefix="/v1", tags=["wallet"])


def _wallet_response(user: str) -> WalletResponse:
    w = store.ledger.balance(user)
    return WalletResponse(balance_bought=w.balance_bought, balance_bonus=w.balance_bonus, total=w.total)


@router.get("/wallet", response_model=WalletResponse)
def wallet(user: str = Depends(current_user)) -> WalletResponse:
    return _wallet_response(user)


@router.get("/wallet/transactions")
def wallet_transactions(user: str = Depends(current_user)) -> list[dict]:
    """The user's own ledger history, newest first (PDD §12.5)."""
    return [
        {"id": t.id, "type": t.type.value, "amount_bought": t.amount_bought,
         "amount_bonus": t.amount_bonus, "reference_type": t.reference_type,
         "reference_id": t.reference_id, "created_at": t.created_at}
        for t in reversed(store.ledger.transactions(user))
    ]


@router.get("/iap/packs", response_model=list[CoinPack])
def packs(storefront: str = "IN") -> list[CoinPack]:
    return [
        CoinPack(sku=sku, storefront=p["storefront"], price_minor=p["price_minor"],
                 currency=p["currency"], coins=p["coins"], bonus_coins=p["bonus"])
        for sku, p in PACKS.items()
        if storefront == "ALL" or p["storefront"] in (storefront, "WEB")
    ]


@router.post("/iap/verify", response_model=WalletResponse)
def iap_verify(req: IapVerifyRequest, user: str = Depends(current_user)) -> WalletResponse:
    """Verify a StoreKit 2 transaction and credit coins idempotently.

    Dev stub: accepts a non-empty JWS and maps SKU→coins. Production validates the JWS
    with Apple's App Store Server Library and keys on the real transactionId (PDD §12.7).
    """
    pack = PACKS.get(req.sku)
    if pack is None or not req.jws:
        raise HTTPException(status_code=400, detail="unknown sku or missing transaction")
    # Idempotency key derives from the (stubbed) transaction identity.
    txn = f"jws:{req.jws}"
    store.ledger.credit(user, TxType.PURCHASE, coins=pack["coins"], reference_type="iap",
                        reference_id=req.sku, idempotency_key=f"iap:{txn}", created_at=CLOCK)
    return _wallet_response(user)


@router.post("/web/orders", response_model=WalletResponse)
def web_order(req: WebOrderRequest, user: str = Depends(current_user)) -> WalletResponse:
    """Web coin purchase (UPI). Credits the pack + the +10% web bonus (PDD §21.4).

    Dev stub: simulates a captured Razorpay webhook. Production credits only after the
    signature-verified `payment.captured` webhook, idempotent by payment id.
    """
    pack = PACKS.get(req.sku)
    if pack is None:
        raise HTTPException(status_code=400, detail="unknown sku")
    store.ledger.credit(user, TxType.PURCHASE, coins=pack["coins"], reference_type="web_order",
                        reference_id=req.sku, idempotency_key=f"web:{user}:{req.sku}", created_at=CLOCK)
    # Every WEB purchase earns the +10% web bonus (PDD §19 decision 11), funded by the
    # absent App Store commission. Any explicit pack bonus is honoured too, whichever is larger.
    web_bonus = max(pack.get("bonus", 0), pack["coins"] * WEB_BONUS_PCT // 100)
    if web_bonus:
        store.ledger.credit(user, TxType.BONUS, coins=web_bonus, reference_type="web_order",
                            reference_id=req.sku, idempotency_key=f"webbonus:{user}:{req.sku}",
                            created_at=CLOCK)
    return _wallet_response(user)


@router.post("/series/{slug}/episodes/{number}/unlock", response_model=UnlockResponse)
def unlock_episode(slug: str, number: int, req: UnlockRequest,
                   user: str = Depends(current_user)) -> UnlockResponse:
    series = catalog.get_series(slug)
    if series is None or not (1 <= number <= series.episode_count):
        raise HTTPException(status_code=404, detail="episode not found")
    eid = catalog.episode_id(slug, number)
    try:
        res = store.ledger.unlock(user, [eid], price_per_episode=series.episode_coin_price,
                                  reference_type="episode", reference_id=eid,
                                  idempotency_key=req.idempotency_key, created_at=CLOCK)
    except InsufficientCoins as e:
        raise HTTPException(status_code=402, detail=str(e))
    return UnlockResponse(episode_ids=[eid], spent_bonus=res.spent_bonus,
                          spent_bought=res.spent_bought, wallet=_wallet_response(user))


@router.post("/series/{slug}/unlock-all", response_model=UnlockResponse)
def unlock_all(slug: str, req: UnlockRequest, user: str = Depends(current_user)) -> UnlockResponse:
    series = catalog.get_series(slug)
    if series is None:
        raise HTTPException(status_code=404, detail="series not found")
    locked = [catalog.episode_id(slug, n)
              for n in range(series.free_episode_count + 1, series.episode_count + 1)]
    # Charge the EXACT advertised bundle price for the episodes not already owned,
    # so what the paywall showed equals what the ledger debits (no per-episode rounding).
    not_owned = [e for e in locked if not store.ledger.is_entitled(user, e)]
    bundle_total = catalog.bundle_price(series, len(not_owned))
    try:
        res = store.ledger.unlock(user, locked, price_per_episode=series.episode_coin_price,
                                  reference_type="bundle", reference_id=slug,
                                  idempotency_key=req.idempotency_key, created_at=CLOCK,
                                  source="bundle", total_cost=bundle_total)
    except InsufficientCoins as e:
        raise HTTPException(status_code=402, detail=str(e))
    return UnlockResponse(episode_ids=locked, spent_bonus=res.spent_bonus,
                          spent_bought=res.spent_bought, wallet=_wallet_response(user))

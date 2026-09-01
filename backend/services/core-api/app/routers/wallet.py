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
import json as _json

from katha_domain.timeutil import now_iso

from ..store import PACKS, WEB_BONUS_PCT, store

router = APIRouter(prefix="/v1", tags=["wallet"])


def _wallet_response(user: str) -> WalletResponse:
    w = store.ledger.balance(user)
    return WalletResponse(balance_bought=w.balance_bought, balance_bonus=w.balance_bonus, total=w.total)


@router.get("/wallet", response_model=WalletResponse)
def wallet(user: str = Depends(current_user)) -> WalletResponse:
    store.refresh_ledger()
    return _wallet_response(user)


@router.get("/wallet/transactions")
def wallet_transactions(user: str = Depends(current_user)) -> list[dict]:
    store.refresh_ledger()
    """The user's own ledger history, newest first (PDD §12.5)."""
    return [
        {"id": t.id, "type": t.type.value, "amount_bought": t.amount_bought,
         "amount_bonus": t.amount_bonus, "reference_type": t.reference_type,
         "reference_id": t.reference_id, "created_at": t.created_at}
        for t in reversed(store.ledger.transactions(user))
    ]


def effective_packs() -> dict:
    """PACKS merged with back-office overrides (admin review #059) — price,
    coins and bonus can be corrected from the panel without a deploy."""
    merged = {sku: dict(p) for sku, p in PACKS.items()}
    for sku, raw in store.kv_prefix("pack:").items():
        if sku in merged:
            try:
                merged[sku].update({k: int(v) for k, v in _json.loads(raw).items()
                                    if k in ("price_minor", "coins", "bonus")})
            except (ValueError, TypeError):
                continue
    return merged


@router.get("/iap/packs", response_model=list[CoinPack])
def packs(storefront: str = "IN", channel: str = "app") -> list[CoinPack]:
    """SKU list per storefront and sales channel.

    Web-only SKUs (the +10%-bonus variants) must never be offered through
    Apple IAP, so channel=app (the default) excludes them; the web store
    passes channel=web to include them.
    """
    packs_cfg = effective_packs()

    def _visible(sku: str) -> bool:
        is_web_sku = sku.startswith("coins_web")
        return is_web_sku if channel == "web" else (channel == "all" or not is_web_sku)
    return [
        CoinPack(sku=sku, storefront=p["storefront"], price_minor=p["price_minor"],
                 currency=p["currency"], coins=p["coins"], bonus_coins=p["bonus"])
        for sku, p in packs_cfg.items()
        if (storefront == "ALL" or p["storefront"] in (storefront, "WEB")) and _visible(sku)
    ]


@router.post("/iap/verify", response_model=WalletResponse)
def iap_verify(req: IapVerifyRequest, user: str = Depends(current_user)) -> WalletResponse:
    """Verify a StoreKit 2 transaction and credit coins idempotently.

    Dev stub: accepts a non-empty JWS and maps SKU→coins. Production validates the JWS
    with Apple's App Store Server Library and keys on the real transactionId (PDD §12.7).
    """
    pack = effective_packs().get(req.sku)
    if pack is None or not req.jws:
        raise HTTPException(status_code=400, detail="unknown sku or missing transaction")
    # Idempotency key derives from the (stubbed) transaction identity.
    txn = f"jws:{req.jws}"
    store.ledger.credit(user, TxType.PURCHASE, coins=pack["coins"], reference_type="iap",
                        reference_id=req.sku, idempotency_key=f"iap:{txn}", created_at=now_iso())
    return _wallet_response(user)


@router.post("/web/orders", response_model=WalletResponse)
def web_order(req: WebOrderRequest, user: str = Depends(current_user)) -> WalletResponse:
    """Web coin purchase (UPI). Credits the pack + the +10% web bonus (PDD §21.4).

    Dev stub: simulates a captured Razorpay webhook. Production credits only after the
    signature-verified `payment.captured` webhook, idempotent by payment id.
    """
    pack = effective_packs().get(req.sku)
    if pack is None:
        raise HTTPException(status_code=400, detail="unknown sku")
    store.ledger.credit(user, TxType.PURCHASE, coins=pack["coins"], reference_type="web_order",
                        reference_id=req.sku, idempotency_key=f"web:{user}:{req.sku}", created_at=now_iso())
    # Every WEB purchase earns the +10% web bonus (PDD §19 decision 11), funded by the
    # absent App Store commission. Any explicit pack bonus is honoured too, whichever is larger.
    web_bonus = max(pack.get("bonus", 0), pack["coins"] * WEB_BONUS_PCT // 100)
    if web_bonus:
        store.ledger.credit(user, TxType.BONUS, coins=web_bonus, reference_type="web_order",
                            reference_id=req.sku, idempotency_key=f"webbonus:{user}:{req.sku}",
                            created_at=now_iso())
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
                                  idempotency_key=req.idempotency_key, created_at=now_iso())
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
                                  idempotency_key=req.idempotency_key, created_at=now_iso(),
                                  source="bundle", total_cost=bundle_total)
    except InsufficientCoins as e:
        raise HTTPException(status_code=402, detail=str(e))
    return UnlockResponse(episode_ids=locked, spent_bonus=res.spent_bonus,
                          spent_bought=res.spent_bought, wallet=_wallet_response(user))

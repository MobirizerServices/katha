"""Playback authorization — the money gate (PDD §12.5, SAD §7.1).

Returns 200 with a signed-URL payload when entitled, or 200 with a `locked` payload
(price + balance + bundle offer) when not — the corrected convention (PDD v0.3.1).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from katha_domain import catalog
from ..deps import current_user
from ..store import CLOCK, store

router = APIRouter(prefix="/v1", tags=["playback"])


def _signed_url(episode_id: str) -> str:
    # Dev stub for CloudFront/Cloudflare signed delivery (SAD §7.1). Never a real secret.
    return f"https://cdn.katha.dev/hls/{episode_id}/master.m3u8?exp={CLOCK}"


@router.post("/series/{slug}/episodes/{number}/playback")
def playback(slug: str, number: int, response: Response, user: str = Depends(current_user)):
    series = catalog.get_series(slug)
    if series is None or not (1 <= number <= series.episode_count):
        raise HTTPException(status_code=404, detail="episode not found")

    eid = catalog.episode_id(slug, number)
    is_free = store.ensure_free(user, slug, number)
    entitled = is_free or store.ledger.is_entitled(user, eid)

    if entitled:
        return {
            "locked": False,
            "episode_id": eid,
            "entitled": True,
            "hls_master_url": _signed_url(eid),
            "expires_at": CLOCK,
            "resume_position_ms": 0,
            "captions": [{"lang": series.primary_language, "url": f".../{eid}/subs.vtt"}],
        }

    remaining_locked = series.episode_count - series.free_episode_count
    return {
        "locked": True,
        "episode_id": eid,
        "price_coins": series.episode_coin_price,
        "balance": store.ledger.balance(user).total,
        "bundle_offer_coins": catalog.bundle_price(series, remaining_locked),
    }

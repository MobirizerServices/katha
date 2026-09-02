"""Playback authorization — the money gate (PDD §12.5, SAD §7.1).

Returns 200 with a signed-URL payload when entitled, or 200 with a `locked` payload
(price + balance + bundle offer) when not — the corrected convention (PDD v0.3.1).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from katha_domain import catalog
from ..deps import current_user
from ..media import media_dir
from katha_domain.timeutil import iso_plus

from ..store import store

router = APIRouter(prefix="/v1", tags=["playback"])


def _signed_url(episode_id: str, user: str) -> str:
    """Tokened stream URL (ADR-012): one HMAC token covers the episode's whole
    HLS tree for this user, expiring with the playback grant."""
    from ..signing import make_token
    slug, _, tail = episode_id.partition(":e")
    epdir = f"{slug}/e{int(tail):03d}/hls/"
    if (media_dir() / epdir / "master.m3u8").is_file():
        token = make_token(epdir, user)
        return f"{catalog.media_base()}/media/t/{token}/{epdir}master.m3u8"
    return f"https://cdn.katha.dev/hls/{episode_id}/master.m3u8?exp={iso_plus(6)}"


def _resume_ms(user: str, eid: str) -> int:
    """Where this viewer left off — a finished episode restarts from the top."""
    from ..store import store as _s
    item = _s.engagement.get(user)
    prog = item.progress.get(eid) if item else None
    if prog is None:
        return 0
    if prog.duration_ms and prog.position_ms >= prog.duration_ms - 3000:
        return 0
    return prog.position_ms


@router.post("/series/{slug}/episodes/{number}/playback")
def playback(slug: str, number: int, response: Response, user: str = Depends(current_user)):
    store.refresh_ledger()
    from ..overrides import get_series, is_served
    series = get_series(slug)
    if series is None or not is_served(slug) or not (1 <= number <= series.episode_count):
        raise HTTPException(status_code=404, detail="episode not found")

    eid = catalog.episode_id(slug, number)
    is_free = store.ensure_free(user, slug, number)
    entitled = is_free or store.ledger.is_entitled(user, eid)

    if entitled:
        store.emit(user, "play_start", ref=eid)
        return {
            "locked": False,
            "episode_id": eid,
            "entitled": True,
            "hls_master_url": _signed_url(eid, user),
            "expires_at": iso_plus(6),
            "resume_position_ms": _resume_ms(user, eid),
            "captions": [{"lang": series.primary_language, "url": f".../{eid}/subs.vtt"}],
        }

    store.emit(user, "paywall_view", ref=eid, value=series.episode_coin_price)
    remaining_locked = series.episode_count - series.free_episode_count
    return {
        "locked": True,
        "episode_id": eid,
        "price_coins": series.episode_coin_price,
        "balance": store.ledger.balance(user).total,
        "bundle_offer_coins": catalog.bundle_price(series, remaining_locked),
    }

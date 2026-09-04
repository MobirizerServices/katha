"""Playback authorization — the money gate (PDD §12.5, SAD §7.1).

Returns 200 with a signed-URL payload when entitled, or 200 with a `locked` payload
(price + balance + bundle offer) when not — the corrected convention (PDD v0.3.1).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from katha_domain import catalog
from katha_domain.schemas import AudioTrack
from ..deps import current_user
from katha_domain.timeutil import iso_plus

from ..store import store

router = APIRouter(prefix="/v1", tags=["playback"])


def _token_root(episode_id: str, user: str) -> tuple[str, str]:
    """(url root, episode dir) for the tokened route (ADR-012): one HMAC token
    covers the episode's whole directory — hls/ tree AND subs/ — for this
    user, expiring with the playback grant. Always the tokened route, whether
    or not the media is on this box: a missing tree is a 404 behind the same
    signature, never an unsigned URL handed to the client."""
    from ..signing import make_token
    slug, _, tail = episode_id.partition(":e")
    epdir = f"{slug}/e{int(tail):03d}/"
    token = make_token(epdir, user)
    return f"{catalog.media_base()}/media/t/{token}/{epdir}", epdir


def _signed_url(episode_id: str, user: str) -> str:
    root, _ = _token_root(episode_id, user)
    return f"{root}hls/master.m3u8"


def _captions(episode_id: str, user: str) -> list[dict]:
    """Every media/{slug}/e{NNN}/subs/{lang}.vtt on disk, served under the
    same stream token as the HLS tree."""
    from ..media import media_dir
    from katha_domain.schemas import CaptionTrack
    root, epdir = _token_root(episode_id, user)
    subs = media_dir() / epdir / "subs"
    out = []
    for f in sorted(subs.glob("*.vtt")) if subs.is_dir() else []:
        out.append(CaptionTrack(lang=f.stem, label=catalog.language_name(f.stem),
                                url=f"{root}subs/{f.name}").model_dump())
    return out


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
            "free": is_free,
            "hls_master_url": _signed_url(eid, user),
            "expires_at": iso_plus(6),
            "resume_position_ms": _resume_ms(user, eid),
            "captions": _captions(eid, user),
            "audio": [AudioTrack(lang=series.primary_language,
                                 label=catalog.language_name(series.primary_language),
                                 kind="original").model_dump()],
        }

    store.emit(user, "paywall_view", ref=eid, value=series.episode_coin_price)
    # The bundle offer is for the episodes this viewer does NOT own yet —
    # exactly the set unlock-all charges for — so the paywall never advertises
    # a different number from the one the ledger debits.
    not_owned = [n for n in range(series.free_episode_count + 1, series.episode_count + 1)
                 if not store.ledger.is_entitled(user, catalog.episode_id(slug, n))]
    return {
        "locked": True,
        "episode_id": eid,
        "price_coins": series.episode_coin_price,
        "balance": store.ledger.balance(user).total,
        "remaining_locked": len(not_owned),
        "bundle_offer_coins": catalog.bundle_price(series, len(not_owned)),
    }

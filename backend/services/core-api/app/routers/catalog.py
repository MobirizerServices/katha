"""Catalog + home feed (public reads; home personalizes with a bearer)."""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException

import json as _json

from katha_domain import catalog
from katha_domain.schemas import HomeResponse, HomeRow, SeriesDetail, SeriesSummary

from .. import overrides
from ..store import store

router = APIRouter(prefix="/v1", tags=["catalog"])


def _overrides() -> tuple[dict, dict]:
    """Back-office status + rating overrides from the shared KV (admin review
    #035/#041). status: live|scheduled|draft|archived — only live is served."""
    status = store.kv_prefix("status:")
    ratings = {}
    for slug, raw in store.kv_prefix("rating:").items():
        try:
            ratings[slug] = _json.loads(raw).get("value", "")
        except ValueError:
            continue
    return status, ratings


def _served(summaries: list[SeriesSummary]) -> list[SeriesSummary]:
    status, ratings = _overrides()
    out = []
    for s in summaries:
        if status.get(s.slug, "live") != "live":
            continue
        if s.slug in ratings and ratings[s.slug]:
            s = s.model_copy(update={"content_rating": ratings[s.slug]})
        out.append(s)
    return out


def _bearer_user(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    from ..auth import decode_token, dev_stubs_enabled
    token = authorization.split(" ", 1)[1].strip()
    payload = decode_token(token)
    if payload:
        return payload["sub"]
    # A bad token personalizes nothing; the raw-id fallback is a dev stub only —
    # in a configured deployment it would hand out any user's watch-based rail.
    return token if dev_stubs_enabled() else None


@router.get("/home", response_model=HomeResponse)
def home(lang: str = "hi",
         authorization: str | None = Header(default=None)) -> HomeResponse:
    """The home rails. Anonymous callers get catalog order; a bearer gets
    events-ranked Trending plus a "Because you watched" rail scored off the
    viewer's own progress (see app/recs.py)."""
    from .. import recs
    served = _served(overrides.all_summaries())
    series = [s for s in served if s.primary_language == lang] or served
    native = {"hi": "हिन्दी", "ta": "தமிழ்", "te": "తెలుగు"}.get(lang, lang)
    rows = [HomeRow(title=f"Trending in {native}", series=recs.rank_trending(series))]
    user = _bearer_user(authorization)
    if user:
        byw = recs.because_you_watched(user, served)
        if byw is not None:
            seed_title, sims = byw
            rows.append(HomeRow(title=f"Because you watched {seed_title}",
                                series=sims))
    rows.append(HomeRow(title="New this week", series=list(reversed(series))[:5]))
    return HomeResponse(rows=rows)


@router.get("/series", response_model=list[SeriesSummary])
def list_series() -> list[SeriesSummary]:
    return _served(overrides.all_summaries())


@router.get("/series/{slug}", response_model=SeriesDetail)
def series_detail(slug: str) -> SeriesDetail:
    s = overrides.get_series(slug)
    status, ratings = _overrides()
    if s is None or status.get(slug, "live") != "live":
        raise HTTPException(status_code=404, detail="series not found")
    if ratings.get(slug):
        s = s.model_copy(update={"content_rating": ratings[slug]})
    return s

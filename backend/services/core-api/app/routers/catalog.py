"""Catalog + home feed (public reads; home personalizes with a bearer)."""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException

import json as _json

from katha_domain import catalog
from katha_domain.schemas import (
    LANGUAGES,
    HomeResponse,
    HomeRow,
    SearchPerson,
    SearchResponse,
    SeriesDetail,
    SeriesSummary,
)

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


@router.get("/search", response_model=SearchResponse)
def search(q: str = "", lang: str | None = None) -> SearchResponse:
    """Catalog search (no auth). Series match on title / native title / tropes /
    genres, case-insensitive substring; people match on the billed cast name.
    Only served (live) series are searchable or listed under a person — the
    same gate as the catalog listing, so an archived title never leaks."""
    needle = q.strip().casefold()
    if not needle:
        raise HTTPException(status_code=400, detail="q is required")
    if lang is not None and lang not in LANGUAGES:
        raise HTTPException(status_code=400,
                            detail=f"lang must be one of {', '.join(LANGUAGES)}")
    served = _served(overrides.all_summaries())
    if lang:
        served = [x for x in served if x.primary_language == lang]
    ranked: list[tuple[int, SeriesSummary]] = []
    people: dict[str, SearchPerson] = {}
    for summary in served:
        d = overrides.get_series(summary.slug)
        if d is None:  # pragma: no cover - a summary always has a detail
            continue
        if needle in d.title.casefold() or needle in d.title_native.casefold():
            ranked.append((0, summary))
        elif any(needle in t.casefold() for t in [*d.tropes, *d.genres]):
            ranked.append((1, summary))
        for c in d.cast:
            if needle not in c.name.casefold():
                continue
            person = people.get(c.name)
            if person is None:
                person = people[c.name] = SearchPerson(name=c.name, role=c.role, series=[])
            person.series.append(summary)
    ranked.sort(key=lambda t: t[0])   # stable: title hits first, catalog order within
    return SearchResponse(query=q.strip(), series=[x for _, x in ranked],
                          people=list(people.values()))

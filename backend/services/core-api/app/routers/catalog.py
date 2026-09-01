"""Catalog + home feed (public reads)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

import json as _json

from katha_domain import catalog
from katha_domain.schemas import HomeResponse, HomeRow, SeriesDetail, SeriesSummary

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


@router.get("/home", response_model=HomeResponse)
def home(lang: str = "hi") -> HomeResponse:
    served = _served(catalog.summaries())
    series = [s for s in served if s.primary_language == lang] or served
    trending = HomeRow(title=f"Trending in {lang}", series=series)
    new_row = HomeRow(title="New this week", series=list(reversed(series))[:5])
    return HomeResponse(rows=[trending, new_row])


@router.get("/series", response_model=list[SeriesSummary])
def list_series() -> list[SeriesSummary]:
    return _served(catalog.summaries())


@router.get("/series/{slug}", response_model=SeriesDetail)
def series_detail(slug: str) -> SeriesDetail:
    s = catalog.get_series(slug)
    status, ratings = _overrides()
    if s is None or status.get(slug, "live") != "live":
        raise HTTPException(status_code=404, detail="series not found")
    if ratings.get(slug):
        s = s.model_copy(update={"content_rating": ratings[slug]})
    return s

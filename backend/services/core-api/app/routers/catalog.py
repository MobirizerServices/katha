"""Catalog + home feed (public reads)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from katha_domain import catalog
from katha_domain.schemas import HomeResponse, HomeRow, SeriesDetail, SeriesSummary

router = APIRouter(prefix="/v1", tags=["catalog"])


@router.get("/home", response_model=HomeResponse)
def home(lang: str = "hi") -> HomeResponse:
    series = [s for s in catalog.summaries() if s.primary_language == lang] or catalog.summaries()
    trending = HomeRow(title=f"Trending in {lang}", series=series)
    new_row = HomeRow(title="New this week", series=list(reversed(series))[:5])
    return HomeResponse(rows=[trending, new_row])


@router.get("/series", response_model=list[SeriesSummary])
def list_series() -> list[SeriesSummary]:
    return catalog.summaries()


@router.get("/series/{slug}", response_model=SeriesDetail)
def series_detail(slug: str) -> SeriesDetail:
    s = catalog.get_series(slug)
    if s is None:
        raise HTTPException(status_code=404, detail="series not found")
    return s

"""Catalog loading + pricing rules (from the seed catalog for dev; from Postgres in prod)."""
from __future__ import annotations

import json
import math
import os
from functools import lru_cache
from pathlib import Path

from .schemas import Episode, SeriesDetail, SeriesSummary

DEFAULT_SEED = (
    Path(__file__).resolve().parents[3]
    / "services" / "core-api" / "app" / "data" / "seed_catalog.json"
)


@lru_cache(maxsize=1)
def _raw() -> dict:
    path = Path(os.environ.get("KATHA_SEED_CATALOG", str(DEFAULT_SEED)))
    return json.loads(path.read_text())


def pricing() -> dict:
    return _raw()["_meta"]["pricing_profile"]


def media_base() -> str:
    """Origin serving /media — core-api itself in dev, the CDN domain in prod."""
    return os.environ.get("KATHA_MEDIA_BASE", "http://127.0.0.1:8799").rstrip("/")


def all_series() -> list[SeriesDetail]:
    prof = pricing()
    base = media_base()
    out: list[SeriesDetail] = []
    for s in _raw()["series"]:
        out.append(
            SeriesDetail(
                slug=s["slug"],
                title=s["title"],
                genres=s.get("genres", []),
                episode_count=s["episode_count"],
                primary_language=s.get("primary_language", "hi"),
                content_rating=s.get("content_rating", "U/A 16+"),
                cover_url=f"{base}/media/{s['slug']}/cover_9x16.jpg",
                cover_wide_url=f"{base}/media/{s['slug']}/cover_16x9.jpg",
                synopsis=s["synopsis"],
                tropes=s.get("tropes", []),
                free_episode_count=prof["free_episode_count"],
                episode_coin_price=prof["episode_coin_price"],
                bundle_discount_pct=prof["bundle_discount_pct"],
                episodes=[Episode(**e) for e in s["episodes"]],
            )
        )
    return out


def get_series(slug: str) -> SeriesDetail | None:
    return next((s for s in all_series() if s.slug == slug), None)


def summaries() -> list[SeriesSummary]:
    return [SeriesSummary(**s.model_dump(include=SeriesSummary.model_fields.keys()))
            for s in all_series()]


def episode_id(slug: str, number: int) -> str:
    return f"{slug}:e{number}"


def bundle_price(series: SeriesDetail, remaining_locked: int) -> int:
    """Price to unlock all remaining locked episodes, after the bundle discount."""
    gross = remaining_locked * series.episode_coin_price
    return math.floor(gross * (100 - series.bundle_discount_pct) / 100)

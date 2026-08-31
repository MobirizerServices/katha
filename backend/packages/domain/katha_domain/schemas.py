"""Pydantic v2 API contracts shared across services (source for OpenAPI → clients)."""
from __future__ import annotations

from pydantic import BaseModel, Field


class Episode(BaseModel):
    number: int
    title: str
    is_free: bool
    coin_price: int


class SeriesSummary(BaseModel):
    slug: str
    title: str
    genres: list[str]
    episode_count: int
    primary_language: str


class SeriesDetail(SeriesSummary):
    synopsis: str
    tropes: list[str] = Field(default_factory=list)
    free_episode_count: int
    episode_coin_price: int
    bundle_discount_pct: int
    episodes: list[Episode]


class HomeRow(BaseModel):
    title: str
    series: list[SeriesSummary]


class HomeResponse(BaseModel):
    rows: list[HomeRow]


class WalletResponse(BaseModel):
    balance_bought: int
    balance_bonus: int
    total: int


class CoinPack(BaseModel):
    sku: str
    storefront: str
    price_minor: int          # in paise / cents
    currency: str
    coins: int
    bonus_coins: int = 0


class PlaybackLocked(BaseModel):
    locked: bool = True
    episode_id: str
    price_coins: int
    balance: int
    bundle_offer_coins: int | None = None   # unlock-all price after 25% bundle discount


class PlaybackGranted(BaseModel):
    locked: bool = False
    episode_id: str
    entitled: bool = True
    hls_master_url: str
    expires_at: str
    resume_position_ms: int = 0
    captions: list[dict] = Field(default_factory=list)


class UnlockRequest(BaseModel):
    idempotency_key: str


class UnlockResponse(BaseModel):
    episode_ids: list[str]
    spent_bonus: int
    spent_bought: int
    wallet: WalletResponse


class IapVerifyRequest(BaseModel):
    jws: str                  # StoreKit 2 signed transaction (verified server-side)
    sku: str


class WebOrderRequest(BaseModel):
    sku: str


class ProblemDetail(BaseModel):
    type: str
    title: str
    status: int
    detail: str | None = None

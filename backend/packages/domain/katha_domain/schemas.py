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
    content_rating: str = "U/A 16+"   # IT Rules 2021 self-classification
    cover_url: str = ""               # 9:16 poster (absolute; media origin from env)
    cover_wide_url: str = ""          # 16:9 billboard


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


# ---- auth -----------------------------------------------------------------
class OtpRequestBody(BaseModel):
    phone: str


class OtpRequestResponse(BaseModel):
    request_id: str
    phone: str
    # Dev only: surfaced so the harness/UI can auto-fill. Never returned in prod.
    dev_hint: str = "any 4-digit code works in the dev slice"


class OtpVerifyBody(BaseModel):
    phone: str
    code: str


class AppleAuthBody(BaseModel):
    identity_token: str
    full_name: str | None = None


class AuthToken(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserProfileResponse"


class UserProfileResponse(BaseModel):
    user_id: str
    kind: str
    display_name: str
    language: str
    phone: str | None = None


class UserProfilePatch(BaseModel):
    display_name: str | None = None
    language: str | None = None


# ---- engagement -----------------------------------------------------------
class ProgressItemBody(BaseModel):
    slug: str
    number: int
    position_ms: int = 0
    duration_ms: int = 0


class ProgressBatchBody(BaseModel):
    items: list[ProgressItemBody]


class ContinueItem(BaseModel):
    slug: str
    number: int
    episode_id: str
    position_ms: int
    duration_ms: int
    title: str
    percent: int


class ContinueResponse(BaseModel):
    items: list[ContinueItem]


class MyListResponse(BaseModel):
    slugs: list[str]
    series: list[SeriesSummary]


class CheckinResponse(BaseModel):
    granted_coins: int
    already_claimed: bool
    day: str
    wallet: WalletResponse


AuthToken.model_rebuild()

"""Pydantic v2 API contracts shared across services (source for OpenAPI → clients)."""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator


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
    # What a WEB purchase of this pack additionally credits (+10% web bonus,
    # or the pack's own bonus if larger) — rendered by the web store, never
    # computed there.
    web_bonus_coins: int = 0


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
    email: str = ""      # invoice delivery (web checkout collects it)
    # PSP payment id (Razorpay payment.captured in production). It keys the
    # credit's idempotency, so a second genuine purchase of the same pack is a
    # new payment, not a silent dedupe; absent (legacy/dev) the key falls back
    # to (user, sku) and replays stay idempotent.
    order_ref: str = ""


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
    # Reports are fire-and-forget and can land out of order; a smaller position
    # is ignored unless the client says the viewer actually scrubbed back.
    rewind: bool = False


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


# ---- back-office draft (admin review #043) -----------------------------------
CONTENT_RATINGS = ("U", "U/A 7+", "U/A 13+", "U/A 16+", "A")   # IT Rules 2021
LANGUAGES = ("hi", "ta", "te")


class SeriesDraft(BaseModel):
    """What the panel may submit to draft a series. Bounds match the finance
    pricing lever so a draft can never carry a price the ledger must refuse."""
    model_config = {"extra": "ignore", "str_strip_whitespace": True}

    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,39}$")
    title: str = Field(min_length=1, max_length=120)
    episode_count: int = Field(ge=1, le=200)
    language: str = "hi"
    genres: list[str] = Field(default_factory=list, max_length=8)
    synopsis: str = Field(default="", max_length=2000)
    rating: str = "U/A 13+"
    coin_price: int | None = Field(default=None, ge=1, le=1000)
    free_episodes: int | None = Field(default=None, ge=0, le=100)

    @field_validator("slug", mode="before")
    @classmethod
    def _lower(cls, v):
        return v.strip().lower() if isinstance(v, str) else v

    @field_validator("language")
    @classmethod
    def _language(cls, v: str) -> str:
        if v not in LANGUAGES:
            raise ValueError(f"must be one of {', '.join(LANGUAGES)}")
        return v

    @field_validator("rating")
    @classmethod
    def _rating(cls, v: str) -> str:
        if v not in CONTENT_RATINGS:
            raise ValueError(f"must be one of {', '.join(CONTENT_RATINGS)}")
        return v

    @field_validator("genres")
    @classmethod
    def _genres(cls, v: list[str]) -> list[str]:
        out = [g.strip() for g in v if g and g.strip()]
        if any(len(g) > 40 for g in out):
            raise ValueError("each genre is at most 40 characters")
        return out

    @model_validator(mode="after")
    def _free_within_count(self):
        if self.free_episodes is not None and self.free_episodes > self.episode_count:
            raise ValueError("free_episodes cannot exceed episode_count")
        return self

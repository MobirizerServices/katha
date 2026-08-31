"""Katha core-api — public mobile + web API (PDD §12.5).

v0.1 dev slice: auth stub, real catalog from the seed data, playback authorization,
wallet, IAP verify, web orders and unlocks — all money through the pure ledger.
Persistence, JWT/App-Attest, rate limits and CDN signing are the next layers.
"""
from __future__ import annotations

from fastapi import FastAPI

from katha_domain import catalog
from .routers import auth as auth_router
from .routers import catalog as catalog_router
from .routers import engagement as engagement_router
from .routers import playback as playback_router
from .routers import wallet as wallet_router

app = FastAPI(
    title="Katha core-api",
    version="0.1.0",
    description="Public mobile + web API. Money is an append-only ledger; the client "
                "computes no prices or entitlements.",
)

app.include_router(auth_router.router)
app.include_router(catalog_router.router)
app.include_router(engagement_router.router)
app.include_router(playback_router.router)
app.include_router(wallet_router.router)


@app.get("/health", tags=["ops"])
def health() -> dict:
    return {"status": "ok", "series": len(catalog.all_series())}


@app.get("/v1/config", tags=["config"])
def config() -> dict:
    """Remote config the clients read (feature flags, pricing defaults, min version)."""
    prof = catalog.pricing()
    return {
        "min_app_version": "1.0.0",
        "free_episode_count": prof["free_episode_count"],
        "episode_coin_price": prof["episode_coin_price"],
        "bundle_discount_pct": prof["bundle_discount_pct"],
        "flags": {
            "rewards.checkin_enabled": True,
            "store.web_enabled": True,
            "offers.first_pack_2x": True,
            "ai.recs_embeddings": False,
        },
    }

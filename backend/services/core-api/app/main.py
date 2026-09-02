"""Katha core-api — public mobile + web API (PDD §12.5).

v0.1 dev slice: auth stub, real catalog from the seed data, playback authorization,
wallet, IAP verify, web orders and unlocks — all money through the pure ledger.
Persistence, JWT/App-Attest, rate limits and CDN signing are the next layers.
"""
from __future__ import annotations

import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from katha_domain import catalog
from katha_domain.flags import effective_flags
from .media import media_dir
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

# Allow the web app (and admin) origins to call the API from the browser.
# Dev default is permissive; production pins to the real web origins.
_origins = os.environ.get(
    "KATHA_CORS_ORIGINS",
    "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000",
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(catalog_router.router)
app.include_router(engagement_router.router)
app.include_router(playback_router.router)
app.include_router(wallet_router.router)


def _serve_media(path: str) -> FileResponse:
    base = media_dir().resolve()
    target = (base / path).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(target)


@app.get("/media/t/{token}/{path:path}", include_in_schema=False)
def media_stream(token: str, path: str) -> FileResponse:
    """Tokened episode streams (ADR-012): the token from /playback authorizes
    this episode's whole HLS tree — master, variants, segments — until it
    expires. Relative playlist references resolve under the token root."""
    from . import signing
    if not signing.check_token(token, path):
        raise HTTPException(status_code=403,
                            detail="stream token invalid or expired")
    return _serve_media(path)


@app.get("/media/{path:path}", include_in_schema=False)
def media(path: str) -> FileResponse:
    """Public media: covers, og cards, the manifest. Episode video only ever
    leaves through the tokened route — a bare URL can't be shared."""
    from . import signing
    if signing.is_video(path):
        raise HTTPException(status_code=403,
                            detail="episode streams need a playback token")
    return _serve_media(path)


@app.get("/health", tags=["ops"])
def health() -> dict:
    return {"status": "ok", "series": len(catalog.all_series())}


@app.get("/v1/config", tags=["config"])
def config(authorization: str | None = Header(default=None)) -> dict:
    """Remote config the clients read (feature flags, pricing defaults, min version).

    Flags = shared defaults merged with admin overrides from the shared DB —
    a toggle flipped in the back office reaches this endpoint on the next call.
    With a bearer token, percentage rollouts (#056) and experiment assignments
    (#061) are evaluated for THAT user; anonymous callers get ramps only at
    100% and no assignments.
    """
    import json as _json

    from katha_domain.flags import bucket

    from .auth import decode_token
    from .store import store as _store
    user: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        payload = decode_token(token)
        user = payload["sub"] if payload else token
    prof = catalog.pricing()
    overrides = _store.shared.flag_overrides() if getattr(_store, "shared", None) else {}
    experiments: dict[str, str] = {}
    if user:
        for key, raw in _store.kv_prefix("exp:").items():
            try:
                exp = _json.loads(raw)
            except ValueError:
                continue
            if exp.get("status") != "running":
                continue
            edge, b = 0, bucket(f"exp:{key}", user)
            for var in exp.get("variants", []):
                edge += int(var.get("pct", 0))
                if b < edge:
                    experiments[key] = var.get("name", "control")
                    break
    try:
        rate = float(_store.kv("config:coin.rupee_rate") or 0.15)
    except ValueError:
        rate = 0.15
    from .store import CHECKIN_COINS
    return {
        "min_app_version": _store.kv("config:app.min_version") or "1.0.0",
        "free_episode_count": prof["free_episode_count"],
        "episode_coin_price": prof["episode_coin_price"],
        "bundle_discount_pct": prof["bundle_discount_pct"],
        # Clients render these; they never carry their own copies (#023):
        "coin_rupee_rate": rate,
        "checkin_coins": CHECKIN_COINS,
        "flags": effective_flags(overrides, user_id=user),
        "experiments": experiments,
    }

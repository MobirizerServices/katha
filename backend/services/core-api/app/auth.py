"""JWT auth for the dev slice (PDD §12.5, SAD §8.1).

`current_user` accepts a signed Katha JWT as the bearer token and returns its
`sub`. In DEV ONLY (see `dev_stubs_enabled`) it *also* accepts a raw user id as
the bearer value (any string that isn't a valid JWT) — so
`Authorization: Bearer test-user-1` still identifies "test-user-1" in the
dev/test harness. User ids are deterministic hashes echoed in API responses, so
this fallback is impersonation-by-design and must never survive into a real
deployment: any non-JWT bearer is a 401 once a real secret is configured.
A missing header is the stable "guest-dev" account in dev only; a configured
deployment answers 401 (clients start a real guest via /v1/auth/guest).

Login is stubbed: OTP verify accepts any 4-digit code, Apple accepts any token.
Real App-Attest / SIWA / OTP-provider verification replaces the stubs; the token
shape the clients see is unchanged.
"""
from __future__ import annotations

import hashlib
import logging
import os
import time

import jwt
from fastapi import Header, HTTPException, Request

_DEV_JWT_SECRET = "dev-katha-secret-not-for-prod-please-override-in-env-0123456789"
JWT_SECRET = os.environ.get("KATHA_JWT_SECRET", _DEV_JWT_SECRET)
JWT_ALG = "HS256"
JWT_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days

if JWT_SECRET == _DEV_JWT_SECRET:
    logging.getLogger("katha.auth").warning(
        "KATHA_JWT_SECRET is not set — running with the committed dev secret and "
        "dev auth stubs (raw-user-id bearers, stubbed IAP). Never deploy like this."
    )


def dev_stubs_enabled() -> bool:
    """Dev/test conveniences: the raw-user-id bearer fallback and the stubbed
    IAP credit. On exactly when the JWT secret is still the committed dev
    default (i.e. never in a configured deployment); `KATHA_DEV_STUBS=1`/`0`
    overrides in either direction for staging demos."""
    flag = os.environ.get("KATHA_DEV_STUBS", "").strip().lower()
    if flag in {"1", "true", "yes"}:
        return True
    if flag in {"0", "false", "no"}:
        return False
    return JWT_SECRET == _DEV_JWT_SECRET


def user_id_for_phone(phone: str) -> str:
    """Deterministic user id from a phone number, so re-login returns the same account."""
    digest = hashlib.sha256(phone.strip().encode()).hexdigest()[:16]
    return f"usr_{digest}"


def user_id_for_apple(sub: str) -> str:
    digest = hashlib.sha256(sub.strip().encode()).hexdigest()[:16]
    return f"apl_{digest}"


def issue_token(user_id: str, *, now: int | None = None) -> str:
    iat = int(now if now is not None else time.time())
    # "ver" is the user's token_version (#021): bumping it in the back office
    # ("sign out all devices") invalidates every token issued before the bump.
    from .store import store
    ver = store.shared.token_version(user_id) if store.shared is not None else 0
    payload = {"sub": user_id, "iat": iat, "exp": iat + JWT_TTL_SECONDS, "ver": ver}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        return None
    return payload if isinstance(payload.get("sub"), str) else None


def current_user(request: Request,
                 authorization: str | None = Header(default=None)) -> str:
    from .store import store
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        payload = decode_token(token)
        if payload is not None:
            user = payload["sub"]
            if store.shared is not None and \
                    store.shared.token_version(user) > int(payload.get("ver", 0)):
                raise HTTPException(status_code=401,
                                    detail="signed out — please sign in again")
        elif dev_stubs_enabled():
            # Dev fallback: a non-JWT bearer value is treated as the raw user id.
            user = token
        else:
            raise HTTPException(status_code=401, detail="invalid or expired token")
    elif dev_stubs_enabled():
        user = "guest-dev"                 # dev/test: one well-known anonymous account
    else:
        # A configured deployment never pools anonymous traffic into one shared
        # wallet/history: clients mint a real guest via POST /v1/auth/guest.
        raise HTTPException(status_code=401, detail="sign in or start a guest session",
                            headers={"WWW-Authenticate": "Bearer"})
    store.touch_seen(user,
                     ua=request.headers.get("user-agent", ""),
                     ip=request.client.host if request.client else "")
    return user

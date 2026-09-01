"""JWT auth for the dev slice (PDD §12.5, SAD §8.1).

`current_user` accepts a signed Katha JWT as the bearer token and returns its
`sub`. For backward compatibility with the dev/test harness it *also* accepts a
raw user id as the bearer value (any string that isn't a valid JWT) — so
`Authorization: Bearer test-user-1` still identifies "test-user-1". A missing
header is a stable guest.

Login is stubbed: OTP verify accepts any 4-digit code, Apple accepts any token.
Real App-Attest / SIWA / OTP-provider verification replaces the stubs; the token
shape the clients see is unchanged.
"""
from __future__ import annotations

import hashlib
import os
import time

import jwt
from fastapi import Header, HTTPException, Request

JWT_SECRET = os.environ.get(
    "KATHA_JWT_SECRET", "dev-katha-secret-not-for-prod-please-override-in-env-0123456789"
)
JWT_ALG = "HS256"
JWT_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days


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
        else:
            # Dev fallback: a non-JWT bearer value is treated as the raw user id.
            user = token
    else:
        user = "guest-dev"
    store.touch_seen(user,
                     ua=request.headers.get("user-agent", ""),
                     ip=request.client.host if request.client else "")
    return user

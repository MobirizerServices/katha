"""Sign in with Apple — identity-token verification (PDD §12.5).

Apple's identity token is an RS256 JWT signed by a key published at
https://appleid.apple.com/auth/keys. A configured deployment verifies the
signature against that JWKS, the issuer, the audience (our bundle id / web
service id, `KATHA_APPLE_BUNDLE_ID`, comma-separated when both apply) and the
expiry, and identifies the user by the stable `sub` claim — never by the token
string, which changes on every sign-in.

Dev/test keep the stub in `routers/auth.py` (any non-empty token, id derived
from the string); `prodguard` refuses a managed env without a bundle id.
"""
from __future__ import annotations

import os

import jwt
from jwt import PyJWKClient

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"

_jwks_client: PyJWKClient | None = None


class AppleTokenInvalid(Exception):
    pass


def audiences() -> list[str]:
    raw = os.environ.get("KATHA_APPLE_BUNDLE_ID", "")
    return [a.strip() for a in raw.split(",") if a.strip()]


def _client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        # PyJWKClient caches the key set and refetches on an unknown kid, which
        # is exactly Apple's rotation model.
        _jwks_client = PyJWKClient(APPLE_JWKS_URL, cache_keys=True, lifespan=6 * 3600)
    return _jwks_client


def verify_identity_token(token: str) -> dict:
    """Return the verified claims (at least `sub`) or raise AppleTokenInvalid."""
    auds = audiences()
    if not auds:
        raise AppleTokenInvalid("KATHA_APPLE_BUNDLE_ID is not configured")
    try:
        key = _client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token, key, algorithms=["RS256"], audience=auds, issuer=APPLE_ISSUER,
            options={"require": ["sub", "exp", "iss", "aud"]},
        )
    except (jwt.PyJWTError, ValueError) as e:  # ValueError: malformed header / unknown kid
        raise AppleTokenInvalid(str(e)) from e
    if not isinstance(claims.get("sub"), str) or not claims["sub"]:
        raise AppleTokenInvalid("missing sub")
    return claims

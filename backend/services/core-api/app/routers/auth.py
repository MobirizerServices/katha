"""Auth + profile endpoints (PDD §12.5). OTP and Apple sign-in are stubbed for
the dev slice: any 4-digit OTP verifies, any Apple identity token is accepted.
Both mint a real signed Katha JWT that the rest of the API verifies."""
from __future__ import annotations

import json
import time
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from katha_domain.schemas import (
    AppleAuthBody,
    AuthToken,
    OtpRequestBody,
    OtpRequestResponse,
    OtpVerifyBody,
    UserProfilePatch,
    UserProfileResponse,
)
from katha_domain.timeutil import now_iso

from ..auth import current_user, issue_token, user_id_for_apple, user_id_for_phone
from ..store import store

router = APIRouter(prefix="/v1", tags=["auth"])

# --- OTP abuse guard (SMS pumping / brute force). Sliding window per phone
# and per client IP; defaults are sized so real users and the UI test suites
# never trip them, while a pumping script (hundreds/min) hits 429 fast.
# KV `config:otp.limits` ({"phone","verify","ip","window_s"}) tunes them live.
_OTP_DEFAULTS = {"phone": 30, "verify": 60, "ip": 240, "window_s": 600}
_otp_hits: dict[str, list[float]] = {}


def _otp_limits() -> dict:
    raw = store.kv("config:otp.limits")
    if not raw:
        return _OTP_DEFAULTS
    try:
        over = json.loads(raw)
        return {k: int(over.get(k, v)) for k, v in _OTP_DEFAULTS.items()}
    except (ValueError, TypeError, AttributeError):
        return _OTP_DEFAULTS


def _otp_throttle(key: str, cap: int, window_s: float) -> int:
    """Record a hit; returns seconds to wait (0 = allowed)."""
    now = time.monotonic()
    hits = [t for t in _otp_hits.get(key, []) if now - t < window_s]
    if len(hits) >= cap:
        _otp_hits[key] = hits
        return max(1, int(window_s - (now - hits[0])) + 1)
    hits.append(now)
    _otp_hits[key] = hits
    return 0


def _otp_guard(request: Request, phone: str, *, kind: str) -> None:
    lim = _otp_limits()
    ip = getattr(request.client, "host", "unknown")
    window = float(lim["window_s"])
    wait = max(_otp_throttle(f"{kind}:p:{phone}", lim[kind], window),
               _otp_throttle(f"otp:ip:{ip}", lim["ip"], window))
    if wait:
        raise HTTPException(status_code=429,
                            detail="too many OTP attempts — try again later",
                            headers={"Retry-After": str(wait)})


def _profile_response(user_id: str) -> UserProfileResponse:
    u = store.get_or_create_user(user_id)
    return UserProfileResponse(
        user_id=u.user_id, kind=u.kind, display_name=u.display_name,
        language=u.language, phone=u.phone,
    )


def _token(user_id: str) -> AuthToken:
    return AuthToken(access_token=issue_token(user_id), user=_profile_response(user_id))


def _merge_guest_from(authorization: str | None, *, into: str) -> None:
    """A login sent with a guest bearer folds that guest into the member."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return
    from ..auth import decode_token
    token = authorization.split(" ", 1)[1].strip()
    payload = decode_token(token)
    guest = payload["sub"] if payload else token
    store.merge_guest(guest, into)


@router.post("/auth/otp/request", response_model=OtpRequestResponse)
def otp_request(body: OtpRequestBody, request: Request) -> OtpRequestResponse:
    if not body.phone.strip():
        raise HTTPException(status_code=400, detail="phone required")
    _otp_guard(request, body.phone.strip(), kind="phone")
    return OtpRequestResponse(request_id=f"otp_{uuid.uuid4().hex[:12]}", phone=body.phone)


@router.post("/auth/otp/verify", response_model=AuthToken)
def otp_verify(body: OtpVerifyBody, request: Request,
               authorization: str | None = Header(default=None)) -> AuthToken:
    code = body.code.strip()
    if not (code.isdigit() and len(code) == 4):
        raise HTTPException(status_code=400, detail="invalid code (dev: any 4 digits)")
    _otp_guard(request, body.phone.strip(), kind="verify")
    user_id = user_id_for_phone(body.phone)
    u = store.get_or_create_user(user_id, kind="phone", phone=body.phone)
    u.kind, u.phone = "phone", body.phone
    store.persist_profile(user_id)   # persist the phone identity to the shared store
    _merge_guest_from(authorization, into=user_id)
    return _token(user_id)


@router.post("/auth/apple", response_model=AuthToken)
def apple_auth(body: AppleAuthBody,
               authorization: str | None = Header(default=None)) -> AuthToken:
    if not body.identity_token.strip():
        raise HTTPException(status_code=400, detail="identity_token required")
    # Dev stub: derive a stable id from the token; prod verifies with Apple's keys.
    user_id = user_id_for_apple(body.identity_token)
    u = store.get_or_create_user(user_id, kind="apple")
    u.kind = "apple"
    if body.full_name and not u.display_name:
        u.display_name = body.full_name
    _merge_guest_from(authorization, into=user_id)
    return _token(user_id)


@router.post("/auth/guest", response_model=AuthToken)
def guest_auth() -> AuthToken:
    user_id = f"gst_{uuid.uuid4().hex[:16]}"
    store.get_or_create_user(user_id, kind="guest")
    return _token(user_id)


@router.get("/me", response_model=UserProfileResponse)
def get_me(user: str = Depends(current_user)) -> UserProfileResponse:
    return _profile_response(user)


@router.patch("/me", response_model=UserProfileResponse)
def patch_me(body: UserProfilePatch, user: str = Depends(current_user)) -> UserProfileResponse:
    u = store.get_or_create_user(user)
    if body.display_name is not None:
        u.display_name = body.display_name
    if body.language is not None:
        if body.language not in ("hi", "ta", "te"):
            raise HTTPException(status_code=400, detail="language must be hi | ta | te")
        u.language = body.language
    return _profile_response(user)


@router.delete("/me")
def delete_me(user: str = Depends(current_user)) -> dict:
    """Account deletion (App Store requirement; PDD §15 DPDP).

    Dev slice: PII (profile) and engagement projections are removed immediately —
    from the in-memory projections AND the shared DB (phone scrubbed, devices and
    push tokens deleted), with a token_version bump so every outstanding 30-day
    JWT dies now instead of quietly re-materializing the profile on its next
    request. The coin ledger is retained as a pseudonymous financial record
    (§12.7). Production adds the 7-day grace window and warehouse/vector
    propagation.
    """
    store.users.pop(user, None)
    store.engagement.pop(user, None)
    if store.shared is not None:
        store.shared.bump_token_version(user)
        store.shared.erase_user(user, now_iso())
    return {"status": "deleted", "user_id": user,
            "note": "coins are not refunded; ledger retained as a financial record"}

"""Auth + profile endpoints (PDD §12.5). OTP and Apple sign-in are stubbed for
the dev slice: any 4-digit OTP verifies, any Apple identity token is accepted.
Both mint a real signed Katha JWT that the rest of the API verifies."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException

from katha_domain.schemas import (
    AppleAuthBody,
    AuthToken,
    OtpRequestBody,
    OtpRequestResponse,
    OtpVerifyBody,
    UserProfilePatch,
    UserProfileResponse,
)
from ..auth import current_user, issue_token, user_id_for_apple, user_id_for_phone
from ..store import store

router = APIRouter(prefix="/v1", tags=["auth"])


def _profile_response(user_id: str) -> UserProfileResponse:
    u = store.get_or_create_user(user_id)
    return UserProfileResponse(
        user_id=u.user_id, kind=u.kind, display_name=u.display_name,
        language=u.language, phone=u.phone,
    )


def _token(user_id: str) -> AuthToken:
    return AuthToken(access_token=issue_token(user_id), user=_profile_response(user_id))


@router.post("/auth/otp/request", response_model=OtpRequestResponse)
def otp_request(body: OtpRequestBody) -> OtpRequestResponse:
    if not body.phone.strip():
        raise HTTPException(status_code=400, detail="phone required")
    return OtpRequestResponse(request_id=f"otp_{uuid.uuid4().hex[:12]}", phone=body.phone)


@router.post("/auth/otp/verify", response_model=AuthToken)
def otp_verify(body: OtpVerifyBody) -> AuthToken:
    code = body.code.strip()
    if not (code.isdigit() and len(code) == 4):
        raise HTTPException(status_code=400, detail="invalid code (dev: any 4 digits)")
    user_id = user_id_for_phone(body.phone)
    u = store.get_or_create_user(user_id, kind="phone", phone=body.phone)
    u.kind, u.phone = "phone", body.phone
    store.persist_profile(user_id)   # persist the phone identity to the shared store
    return _token(user_id)


@router.post("/auth/apple", response_model=AuthToken)
def apple_auth(body: AppleAuthBody) -> AuthToken:
    if not body.identity_token.strip():
        raise HTTPException(status_code=400, detail="identity_token required")
    # Dev stub: derive a stable id from the token; prod verifies with Apple's keys.
    user_id = user_id_for_apple(body.identity_token)
    u = store.get_or_create_user(user_id, kind="apple")
    u.kind = "apple"
    if body.full_name and not u.display_name:
        u.display_name = body.full_name
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

    Dev slice: PII (profile) and engagement projections are removed immediately;
    the coin ledger is retained as a pseudonymous financial record (§12.7).
    Production adds the 7-day grace window and warehouse/vector propagation.
    """
    store.users.pop(user, None)
    store.engagement.pop(user, None)
    return {"status": "deleted", "user_id": user,
            "note": "coins are not refunded; ledger retained as a financial record"}

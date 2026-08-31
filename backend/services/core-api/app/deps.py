"""Request dependencies. Dev-slice auth: `Authorization: Bearer <user_id>` identifies
the caller; a missing header is treated as a stable guest. Production replaces this
with the JWT/App-Attest interceptor (SAD §8.1) — routers are unchanged."""
from __future__ import annotations

from fastapi import Header


def current_user(authorization: str | None = Header(default=None)) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    return "guest-dev"

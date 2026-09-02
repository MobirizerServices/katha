"""Role-based access control for the back office (PDD §14, SAD §8.2).

Identity resolves in two ways (see `oidc.py`):
- an OIDC session cookie — the operator's email, with the role looked up in the
  server-side directory on EVERY request (revocation is instant). Mutations
  must carry `X-Katha-CSRF: 1`.
- with `KATHA_ADMIN_AUTH=headers` (an explicit dev/test opt-in — the default
  is `oidc`), the historical `X-Actor-Id` + `X-Role` headers still work when
  no session is present. In `oidc` mode those headers are ignored entirely.

`require(*roles)` is a FastAPI dependency factory that 401s an unauthenticated
caller and 403s one whose role is not permitted for the route.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from fastapi import Depends, Header, HTTPException, Request


class Role(str, Enum):
    ADMIN = "admin"        # full access
    CONTENT = "content"    # catalog / publishing
    QC = "qc"              # quality control
    SUPPORT = "support"    # user support (small goodwill adjustments)
    FINANCE = "finance"    # finance corrections + approvals
    ANALYST = "analyst"    # read analytics + audit
    RO = "ro"              # read-only observer


@dataclass(frozen=True)
class Actor:
    id: str
    role: Role


def _actor(
    request: Request,
    x_actor_id: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
) -> Actor:
    from . import oidc

    ident = oidc.session_identity(request)
    if ident is not None:
        role = oidc.directory_role(ident["email"])
        if role is None:
            raise HTTPException(
                status_code=401,
                detail="your access was revoked — ask an admin to re-provision you")
        if (request.method not in ("GET", "HEAD", "OPTIONS")
                and request.headers.get("x-katha-csrf") != "1"):
            raise HTTPException(status_code=403, detail="missing X-Katha-CSRF header")
        return Actor(id=ident["email"], role=Role(role))

    if oidc.auth_mode() == "oidc":
        raise HTTPException(
            status_code=401, detail="sign in required",
            headers={"X-Katha-Login": "/admin/v1/auth/login"})

    if not x_actor_id or not x_role:
        raise HTTPException(status_code=401, detail="missing X-Actor-Id / X-Role")
    try:
        role = Role(x_role.strip().lower())
    except ValueError:
        raise HTTPException(status_code=401, detail=f"unknown role: {x_role}")
    return Actor(id=x_actor_id.strip(), role=role)


def require(*roles: Role):
    """Dependency that admits ADMIN plus any of the listed roles."""
    allowed = {Role.ADMIN, *roles}

    def _dep(actor: Actor = Depends(_actor)) -> Actor:
        if actor.role not in allowed:
            raise HTTPException(
                status_code=403,
                detail=f"role {actor.role.value} not permitted "
                       f"(need one of {sorted(r.value for r in allowed)})",
            )
        return actor

    return _dep


# The capability → roles matrix, served to the Roles & Access page so the docs
# can never drift from enforcement (routes below reference these same names).
MATRIX: list[dict] = [
    {"capability": "Create / edit series & episodes", "roles": ["admin", "content"]},
    {"capability": "Publish / schedule / takedown", "roles": ["admin", "content"],
     "notes": {"qc": "takedown"}},
    {"capability": "Rating & moderation decisions", "roles": ["admin", "qc", "content"]},
    {"capability": "View user PII (phone)", "roles": ["admin", "support"],
     "notes": {"finance": "masked"}},
    {"capability": "Coin adjustment ≤ 500", "roles": ["admin", "support", "finance"]},
    {"capability": "Coin adjustment > 500", "roles": ["admin"],
     "notes": {"support": "request", "finance": "approve"}},
    {"capability": "Refunds & clawbacks", "roles": ["admin", "finance", "support"]},
    {"capability": "Grievance triage", "roles": ["admin", "support"]},
    {"capability": "Flags, experiments, SKUs", "roles": ["admin"],
     "notes": {"content": "flags", "finance": "SKUs"}},
    {"capability": "DPDP export / erase", "roles": ["admin"]},
    {"capability": "Analytics dashboards",
     "roles": ["admin", "content", "qc", "support", "finance", "analyst", "ro"]},
    {"capability": "Audit log",
     "roles": ["admin", "finance", "analyst", "ro"],
     "notes": {"content": "own", "qc": "own", "support": "own"}},
]

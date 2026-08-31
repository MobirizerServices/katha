"""Role-based access control for the back office (PDD §14, SAD §8.2).

Dev auth: the acting operator is read from `X-Actor-Id` + `X-Role` headers (prod
swaps in Google Workspace OIDC → the same `Actor`). `require(*roles)` is a
FastAPI dependency factory that 401s an unauthenticated caller and 403s one whose
role is not permitted for the route.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from fastapi import Depends, Header, HTTPException


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
    x_actor_id: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
) -> Actor:
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

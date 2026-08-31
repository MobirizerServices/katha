"""Request dependencies. `current_user` now verifies a Katha JWT bearer token
(see `app.auth`), while still accepting a raw user id as the bearer value for the
dev/test harness. A missing header is a stable guest."""
from __future__ import annotations

from .auth import current_user

__all__ = ["current_user"]

"""Fail-closed production config guard.

In any non-dev environment (`KATHA_ENV` = qa | staging | prod | production) the
services must refuse to boot when a security-critical secret is missing or still
the committed dev default, or when a dev auth mode is left on. This is what turns
the review's hardening from "warns" into "cannot run insecurely" — the dev
fallbacks (raw-bearer auth, the IAP stub) key off these same secrets, so once
they are real, the stubs are off.

`KATHA_ENV` unset or "dev"/"test"/"local" → every check is a no-op, so the test
suite and local runs are untouched.
"""
from __future__ import annotations

import os

# The committed dev defaults these must never equal in a real environment.
_DEV_JWT_SECRET = "dev-katha-secret-not-for-prod-please-override-in-env-0123456789"
_DEV_STREAM_SECRET = "katha-dev-stream-secret"

_MANAGED_ENVS = {"qa", "staging", "stage", "prod", "production"}


class InsecureConfigError(RuntimeError):
    """Raised at startup when a managed env is configured insecurely."""


def is_managed_env() -> bool:
    return os.environ.get("KATHA_ENV", "dev").strip().lower() in _MANAGED_ENVS


def _require_secret(name: str, *, dev_default: str | None, problems: list[str]) -> None:
    val = os.environ.get(name)
    if not val:
        problems.append(f"{name} is not set")
    elif dev_default is not None and val == dev_default:
        problems.append(f"{name} is still the committed dev default")


def enforce(service: str) -> None:
    """Validate the environment for `service` ('core-api' | 'admin-api').
    No-op outside a managed env; raises InsecureConfigError listing every
    problem otherwise, so the process dies before serving a request.
    """
    if not is_managed_env():
        return

    problems: list[str] = []

    if service == "core-api":
        _require_secret("KATHA_JWT_SECRET", dev_default=_DEV_JWT_SECRET, problems=problems)
        _require_secret("KATHA_STREAM_SECRET", dev_default=_DEV_STREAM_SECRET, problems=problems)
        if os.environ.get("KATHA_DEV_STUBS", "").strip().lower() in {"1", "true", "yes"}:
            problems.append("KATHA_DEV_STUBS is enabled (raw-bearer auth + IAP stub) in a managed env")
        if not os.environ.get("KATHA_CORS_ORIGINS"):
            problems.append("KATHA_CORS_ORIGINS is not pinned (defaults are permissive dev origins)")
    elif service == "admin-api":
        _require_secret("KATHA_ADMIN_SESSION_SECRET", dev_default=None, problems=problems)
        if os.environ.get("KATHA_ADMIN_AUTH", "oidc").strip().lower() != "oidc":
            problems.append("KATHA_ADMIN_AUTH must be 'oidc' in a managed env (header identity is dev-only)")
    else:
        raise ValueError(f"unknown service: {service}")

    # Persistence is mandatory in a managed env — the in-memory store loses money
    # rows on restart.
    if os.environ.get("KATHA_PERSIST") != "1":
        problems.append("KATHA_PERSIST=1 is required (managed envs must persist the ledger)")
    if os.environ.get("KATHA_DB_URL", "").startswith("sqlite") or not os.environ.get("KATHA_DB_URL"):
        problems.append("KATHA_DB_URL must point at a server database (not SQLite)")

    if problems:
        raise InsecureConfigError(
            f"refusing to start {service} in KATHA_ENV="
            f"{os.environ.get('KATHA_ENV')} — fix:\n  - " + "\n  - ".join(problems))

"""Fail-closed production config guard.

In any non-dev environment (`KATHA_ENV` = qa | staging | prod | production) the
services must refuse to boot when a security-critical secret is missing or still
the committed dev default, when a dev auth mode is left on, or when login would
run on a stub (no OTP provider, no Apple audience, no shared Redis). This is what turns
the review's hardening from "warns" into "cannot run insecurely" — the dev
fallbacks (raw-bearer auth, the IAP stub) key off these same secrets, so once
they are real, the stubs are off.

`KATHA_ENV` = "dev"/"test"/"local" → every check is a no-op, so the test suite
and local runs are untouched. UNSET counts as managed: forgetting the variable
must fail closed, not open.
"""
from __future__ import annotations

import os

# The committed dev defaults these must never equal in a real environment.
_DEV_JWT_SECRET = "dev-katha-secret-not-for-prod-please-override-in-env-0123456789"
_DEV_STREAM_SECRET = "katha-dev-stream-secret"

_MANAGED_ENVS = {"qa", "staging", "stage", "prod", "production"}


class InsecureConfigError(RuntimeError):
    """Raised at startup when a managed env is configured insecurely."""


_DEV_ENVS = {"dev", "test", "local"}


def is_managed_env() -> bool:
    """Managed unless the deployer EXPLICITLY says dev/test/local. An unset
    KATHA_ENV used to mean "dev" — so an image run without it served the
    committed secrets and the auth stubs on a reachable host."""
    raw = os.environ.get("KATHA_ENV")
    if raw is None:
        return True
    return raw.strip().lower() not in _DEV_ENVS


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
        # Login must be real: without a provider, OTP verify accepts ANY 4-digit
        # code for ANY phone (account takeover by phone number), and the console
        # provider just logs the code.
        provider = os.environ.get("KATHA_OTP_PROVIDER", "").strip().lower()
        if not provider:
            problems.append("KATHA_OTP_PROVIDER is not set (OTP verify would accept any code)")
        elif provider == "console":
            problems.append("KATHA_OTP_PROVIDER=console logs codes instead of sending them")
        if not os.environ.get("KATHA_APPLE_BUNDLE_ID"):
            problems.append("KATHA_APPLE_BUNDLE_ID is not set (Apple identity tokens cannot be verified)")
        # OTP codes/attempts and the abuse limiter live in Redis; per-process
        # memory splits them across gunicorn workers (caps multiply, codes
        # minted on one worker fail to verify on another).
        workers = os.environ.get("KATHA_WORKERS", "").strip()
        if not os.environ.get("KATHA_REDIS_URL") and workers != "1":
            problems.append("KATHA_REDIS_URL is required with more than one worker "
                            "(OTP store + rate limits must be shared)")
    elif service == "admin-api":
        _require_secret("KATHA_ADMIN_SESSION_SECRET", dev_default=None, problems=problems)
        if os.environ.get("KATHA_ADMIN_AUTH", "oidc").strip().lower() != "oidc":
            problems.append("KATHA_ADMIN_AUTH must be 'oidc' in a managed env (header identity is dev-only)")
        # A blank issuer selects the built-in dev IdP, whose sign-in page is a
        # one-click "become admin" — so the real relying-party config is
        # mandatory, not optional.
        for name in ("KATHA_OIDC_ISSUER", "KATHA_OIDC_CLIENT_ID", "KATHA_OIDC_CLIENT_SECRET"):
            _require_secret(name, dev_default=None, problems=problems)
        redirect = os.environ.get("KATHA_OIDC_REDIRECT_URL", "")
        if not redirect.startswith("https://"):
            problems.append("KATHA_OIDC_REDIRECT_URL must be set to the https callback "
                            "(defaults to localhost, which no IdP will accept)")
        if os.environ.get("KATHA_ADMIN_COOKIE_SECURE") != "1":
            problems.append("KATHA_ADMIN_COOKIE_SECURE=1 is required (session cookies over TLS only)")
        if not os.environ.get("KATHA_ADMIN_CORS"):
            problems.append("KATHA_ADMIN_CORS is not pinned (defaults are localhost dev origins)")
        if not os.environ.get("KATHA_ADMIN_IP_ALLOWLIST", "").strip():
            problems.append("KATHA_ADMIN_IP_ALLOWLIST is empty (the back office must sit behind "
                            "the VPN/office CIDRs — see the security posture doc)")
        _require_secret("KATHA_AUDIT_HMAC_KEY", dev_default=None, problems=problems)
        if not os.environ.get("KATHA_ADMIN_USERS", "").strip():
            problems.append("KATHA_ADMIN_USERS is not set (the default bootstrap admin "
                            "ops@katha.dev is a dev convenience)")
    else:
        raise ValueError(f"unknown service: {service}")

    # Persistence is mandatory in a managed env — the in-memory store loses money
    # rows on restart.
    if os.environ.get("KATHA_PERSIST") != "1":
        problems.append("KATHA_PERSIST=1 is required (managed envs must persist the ledger)")
    if os.environ.get("KATHA_DB_URL", "").startswith("sqlite") or not os.environ.get("KATHA_DB_URL"):
        problems.append("KATHA_DB_URL must point at a server database (not SQLite)")

    if problems:
        env = os.environ.get("KATHA_ENV")
        hint = ("" if env is not None else
                "\n  (KATHA_ENV is not set, which counts as a managed environment; "
                "set KATHA_ENV=dev for a local run)")
        raise InsecureConfigError(
            f"refusing to start {service} in KATHA_ENV={env} — fix:\n  - "
            + "\n  - ".join(problems) + hint)

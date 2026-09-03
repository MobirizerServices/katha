"""OTP delivery + verification (P0-4).

Dev/test keep the stub (any 4-digit code verifies) — nothing here changes that.
When KATHA_OTP_PROVIDER is set, real OTP kicks in: a random code is generated,
stored with a TTL and an attempt cap (Redis, or in-memory for a single-box QA),
sent over the configured provider, and checked on verify.

Providers (KATHA_OTP_PROVIDER):
  console  — log the code (single-box QA without an SMS account)
  msg91    — MSG91 flow/OTP API (KATHA_MSG91_KEY, KATHA_MSG91_TEMPLATE)
  twilio   — Twilio Verify (KATHA_TWILIO_SID, KATHA_TWILIO_TOKEN, KATHA_TWILIO_SERVICE)
"""
from __future__ import annotations

import logging
import os
import secrets
import time

_log = logging.getLogger("katha.otp")
_TTL_S = 300
_MAX_ATTEMPTS = 5
_mem: dict[str, tuple[str, float, int]] = {}   # phone -> (code, expires_at, attempts)


def enabled() -> bool:
    return bool(os.environ.get("KATHA_OTP_PROVIDER"))


def _redis():
    dsn = os.environ.get("KATHA_REDIS_URL")
    if not dsn:
        return None
    try:  # pragma: no cover - needs a live Redis
        import redis
        c = redis.Redis.from_url(dsn, socket_timeout=0.25)
        c.ping()
        return c
    except Exception:  # pragma: no cover
        return None


def _store_code(phone: str, code: str) -> None:
    r = _redis()
    if r is not None:  # pragma: no cover - needs a live Redis
        r.setex(f"otp:code:{phone}", _TTL_S, code)
        r.delete(f"otp:tries:{phone}")
        return
    _mem[phone] = (code, time.time() + _TTL_S, 0)


def generate_and_send(phone: str) -> None:
    """Create a fresh code, store it, and dispatch it over the provider."""
    code = f"{secrets.randbelow(10000):04d}"
    _store_code(phone, code)
    provider = os.environ.get("KATHA_OTP_PROVIDER", "console").lower()
    if provider == "console":
        _log.info("OTP for %s is %s (console provider)", phone, code)
    else:  # pragma: no cover - real SMS providers need network + credentials
        _send_via_provider(provider, phone, code)


def _send_via_provider(provider: str, phone: str, code: str) -> None:  # pragma: no cover
    import httpx
    if provider == "msg91":
        httpx.post("https://control.msg91.com/api/v5/otp",
                   params={"mobile": phone, "otp": code,
                           "template_id": os.environ.get("KATHA_MSG91_TEMPLATE", "")},
                   headers={"authkey": os.environ.get("KATHA_MSG91_KEY", "")}, timeout=5)
    elif provider == "twilio":
        sid = os.environ.get("KATHA_TWILIO_SID", "")
        svc = os.environ.get("KATHA_TWILIO_SERVICE", "")
        httpx.post(f"https://verify.twilio.com/v2/Services/{svc}/Verifications",
                   data={"To": phone, "Channel": "sms"},
                   auth=(sid, os.environ.get("KATHA_TWILIO_TOKEN", "")), timeout=5)
    else:
        raise ValueError(f"unknown OTP provider: {provider}")


def verify(phone: str, code: str) -> bool:
    """Check a submitted code against the stored one, enforcing the attempt cap."""
    r = _redis()
    if r is not None:  # pragma: no cover - needs a live Redis
        tries = r.incr(f"otp:tries:{phone}")
        if tries > _MAX_ATTEMPTS:
            return False
        stored = r.get(f"otp:code:{phone}")
        stored = stored.decode() if stored else None
        ok = stored is not None and secrets.compare_digest(stored, code)
        if ok:
            r.delete(f"otp:code:{phone}", f"otp:tries:{phone}")
        return ok
    rec = _mem.get(phone)
    if rec is None:
        return False
    stored, expires, attempts = rec
    if time.time() > expires or attempts >= _MAX_ATTEMPTS:
        _mem.pop(phone, None)
        return False
    if secrets.compare_digest(stored, code):
        _mem.pop(phone, None)
        return True
    _mem[phone] = (stored, expires, attempts + 1)
    return False

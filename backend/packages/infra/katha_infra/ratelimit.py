"""Cross-replica fixed-window rate limiter (P0-7).

The app tier runs several gunicorn workers behind several replicas; an in-memory
counter lets each of them allow the full cap independently. When KATHA_REDIS_URL
is set, counting moves to Redis so the limit is shared. Fail-open on a Redis
error — the nginx edge zones are the hard backstop, so a Redis blip must never
lock users out.

Callers that have their own in-memory fallback (the OTP guard) check `.enabled`
and only use `.hit()` when Redis is actually wired.
"""
from __future__ import annotations

import logging
import os

_log = logging.getLogger("katha.ratelimit")


class RateLimiter:
    def __init__(self, url: str | None = None) -> None:
        self.redis = None
        dsn = url if url is not None else os.environ.get("KATHA_REDIS_URL")
        if dsn:
            try:  # pragma: no cover - needs a live Redis
                import redis
                client = redis.Redis.from_url(dsn, socket_timeout=0.25)
                client.ping()
                self.redis = client
            except Exception:  # pragma: no cover - unreachable Redis
                _log.warning("KATHA_REDIS_URL set but Redis is unreachable — "
                             "rate limiter disabled (edge nginx still guards)")
                self.redis = None

    @property
    def enabled(self) -> bool:
        return self.redis is not None

    def hit(self, key: str, cap: int, window_s: float) -> tuple[bool, int]:
        """Count one hit on `key`. Returns (allowed, retry_after_seconds)."""
        if self.redis is None:
            return True, 0
        try:  # pragma: no cover - needs a live Redis
            pipe = self.redis.pipeline()
            pipe.incr(key)
            pipe.ttl(key)
            n, ttl = pipe.execute()
            if ttl is None or ttl < 0:
                self.redis.expire(key, int(window_s))
                ttl = int(window_s)
            if n > cap:
                return False, max(1, int(ttl))
            return True, 0
        except Exception:  # pragma: no cover - fail open on Redis error
            return True, 0

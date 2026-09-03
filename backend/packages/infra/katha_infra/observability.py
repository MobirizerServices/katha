"""Observability wiring (P1-3): error capture + structured logs.

All env-gated and dependency-optional — with nothing set (dev/test) `init` is a
no-op, and a missing library is swallowed rather than crashing the app.

  SENTRY_DSN        → initialize Sentry error/perf capture
  KATHA_JSON_LOGS=1 → emit one-line JSON logs (ship straight to a log pipeline)
  KATHA_ENV         → tags the environment on both
"""
from __future__ import annotations

import json
import logging
import os
import sys


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def init(service: str) -> None:
    env = os.environ.get("KATHA_ENV", "dev")

    dsn = os.environ.get("SENTRY_DSN")
    if dsn:
        try:
            import sentry_sdk
            sentry_sdk.init(
                dsn=dsn, environment=env,
                release=os.environ.get("KATHA_RELEASE"),
                traces_sample_rate=float(os.environ.get("KATHA_TRACES_SAMPLE", "0.1")),
            )
            sentry_sdk.set_tag("service", service)
        except Exception:  # pragma: no cover - optional dep / network
            logging.getLogger("katha.obs").warning("SENTRY_DSN set but Sentry init failed")

    if os.environ.get("KATHA_JSON_LOGS") == "1":
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(_JsonFormatter())
        root = logging.getLogger()
        root.handlers[:] = [handler]
        root.setLevel(os.environ.get("KATHA_LOG_LEVEL", "INFO"))

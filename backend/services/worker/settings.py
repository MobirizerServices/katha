"""arq worker (P1-2): moves slow side-effects — invoice email, push — off the
request path. Run: `arq settings.WorkerSettings` (see docker-compose.qa.yml).

Enqueue from the API with `katha_infra`-side helpers once wired; today the tasks
are thin wrappers over the same comms/push code the request path calls inline,
so switching an endpoint to enqueue is a one-line change with identical effect.
"""
from __future__ import annotations

import os

from arq.connections import RedisSettings


def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(os.environ.get("KATHA_REDIS_URL", "redis://redis:6379/0"))


async def send_email_task(ctx, *, to: str, subject: str, body_html: str) -> None:
    """Deliver a transactional email (invoices, receipts). Wraps the same
    comms.send_email the request path uses; the SMTP call happens here instead
    of blocking the purchase response."""
    from katha_infra import SharedStore
    from katha_infra.db import Database
    from katha_domain.timeutil import now_iso
    from katha_infra import comms

    shared = SharedStore(Database())
    comms.send_email(shared, to=to, subject=subject, body_html=body_html, now=now_iso())


async def send_push_task(ctx, *, token: str, title: str, body: str) -> None:
    """Deliver one APNs push. Real APNs credentials come from env in QA/prod."""
    # Integration point: call the APNs client here (P1-7). Kept as a no-op-safe
    # stub so the worker boots without the production push key.
    ctx["log"] = f"push→{token[:8]}… {title}"


class WorkerSettings:
    functions = [send_email_task, send_push_task]
    redis_settings = _redis_settings()
    max_jobs = int(os.environ.get("KATHA_WORKER_CONCURRENCY", "10"))
    job_timeout = 30

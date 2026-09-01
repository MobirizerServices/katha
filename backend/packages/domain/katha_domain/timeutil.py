"""Real time for money rows (admin review #001).

Every ledger/audit write stamps actual UTC; product-day logic (daily check-in)
runs on IST, where the audience lives. The old frozen CLOCK constant survives
only in historical rows.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def now_iso() -> str:
    """UTC, second precision, e.g. 2026-09-01T09:14:03+00:00."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def ist_day() -> str:
    """Today's date in IST (daily check-in boundary), e.g. 2026-09-01."""
    return datetime.now(IST).date().isoformat()


def iso_plus(hours: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(timespec="seconds")

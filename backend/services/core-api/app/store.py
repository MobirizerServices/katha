"""In-memory application store for the dev slice.

Holds one process-wide Ledger and grants the free episodes on first playback.
In production these become SQLAlchemy repositories over Postgres (schema-owned by
domain services); the ledger rules are unchanged — this only swaps persistence.
"""
from __future__ import annotations

from katha_domain import catalog
from katha_ledger import Ledger

# Coin packs mirror App Store Connect / web SKUs (PDD §8.2). `coins` is credited to the
# bought pool; web SKUs additionally credit a +10% bonus (PDD §19 decision 11).
PACKS = {
    "coins_starter_in": dict(storefront="IN", price_minor=9900, currency="INR", coins=600, bonus=0),
    "coins_popular_in": dict(storefront="IN", price_minor=19900, currency="INR", coins=1300, bonus=0),
    "coins_value_in": dict(storefront="IN", price_minor=49900, currency="INR", coins=3500, bonus=0),
    "coins_binge_in": dict(storefront="IN", price_minor=99900, currency="INR", coins=7500, bonus=0),
    "coins_mega_in": dict(storefront="IN", price_minor=199900, currency="INR", coins=16000, bonus=0),
    "coins_web_popular_in": dict(storefront="WEB", price_minor=19900, currency="INR", coins=1300, bonus=130),
}

# A fixed clock keeps the dev slice deterministic and mirrors the ledger's design.
CLOCK = "2026-09-14T14:03:22+05:30"


class Store:
    def __init__(self) -> None:
        self.ledger = Ledger()

    def ensure_free(self, user_id: str, slug: str, number: int) -> bool:
        """Grant + report free entitlement for the first N episodes of a series."""
        series = catalog.get_series(slug)
        if series is None:
            return False
        if number <= series.free_episode_count:
            eid = catalog.episode_id(slug, number)
            if not self.ledger.is_entitled(user_id, eid):
                self.ledger.grant_free(user_id, eid, created_at=CLOCK)
            return True
        return False


store = Store()

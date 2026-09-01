"""Application store for the dev slice.

Holds one process-wide ledger plus lightweight projections (user profiles, watch
progress, My List). The ledger is the money source of truth; by default it is the
pure in-memory `Ledger` (so the test suite stays fast and deterministic). Set
`KATHA_PERSIST=1` (optionally with `KATHA_DB_URL`) to swap in the persistent
adapter so wallets and entitlements survive a restart — the routers are unchanged.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

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
CLOCK_DAY = CLOCK[:10]  # "2026-09-14" — used for idempotent daily check-ins.
CHECKIN_COINS = 5
WEB_BONUS_PCT = 10  # +10% web bonus on any web-store purchase (PDD §19 decision 11)


@dataclass
class UserProfile:
    user_id: str
    kind: str = "guest"          # guest | phone | apple
    display_name: str = ""
    language: str = "hi"         # hi | ta | te
    phone: str | None = None


@dataclass
class ProgressItem:
    slug: str
    number: int
    episode_id: str
    position_ms: int = 0
    duration_ms: int = 0
    updated_at: str = CLOCK


@dataclass
class UserEngagement:
    progress: dict[str, ProgressItem] = field(default_factory=dict)  # episode_id -> item
    order: list[str] = field(default_factory=list)                   # continue-watching order
    my_list: list[str] = field(default_factory=list)                 # series slugs, newest first


def _build_ledger():
    if os.environ.get("KATHA_PERSIST") == "1":
        from katha_infra import PersistentLedger
        return PersistentLedger()
    return Ledger()


class Store:
    def __init__(self) -> None:
        self.ledger = _build_ledger()
        self.users: dict[str, UserProfile] = {}
        self.engagement: dict[str, UserEngagement] = {}
        # In persist mode, share the ledger's DB so user identities land in the
        # same store the back office reads (SharedStore) — makes the surfaces one system.
        self.shared = None
        if os.environ.get("KATHA_PERSIST") == "1":
            from katha_infra import SharedStore
            self.shared = SharedStore(db=getattr(self.ledger, "_db", None))

    # ---- users ----------------------------------------------------------
    def get_or_create_user(self, user_id: str, **defaults) -> UserProfile:
        u = self.users.get(user_id)
        if u is None:
            u = UserProfile(user_id=user_id, **defaults)
            self.users[user_id] = u
        self.persist_profile(user_id)
        return u

    def persist_profile(self, user_id: str) -> None:
        """Upsert the user's identity into the shared store (no-op off persist mode)."""
        if self.shared is None:
            return
        u = self.users.get(user_id)
        if u is not None:
            self.shared.upsert_profile(user_id, phone=u.phone or "", kind=u.kind,
                                       language=u.language, created_at=CLOCK)

    # ---- engagement -----------------------------------------------------
    def _eng(self, user_id: str) -> UserEngagement:
        return self.engagement.setdefault(user_id, UserEngagement())

    def record_progress(self, user_id: str, slug: str, number: int, position_ms: int,
                        duration_ms: int) -> ProgressItem:
        eng = self._eng(user_id)
        eid = catalog.episode_id(slug, number)
        item = ProgressItem(slug=slug, number=number, episode_id=eid,
                            position_ms=max(0, position_ms), duration_ms=max(0, duration_ms))
        eng.progress[eid] = item
        # Move to the front of the continue-watching order.
        if eid in eng.order:
            eng.order.remove(eid)
        eng.order.insert(0, eid)
        return item

    def continue_watching(self, user_id: str) -> list[ProgressItem]:
        eng = self._eng(user_id)
        out: list[ProgressItem] = []
        for eid in eng.order:
            item = eng.progress.get(eid)
            # Only surface episodes that are started but not finished.
            if item and (item.duration_ms == 0 or item.position_ms < item.duration_ms):
                out.append(item)
        return out

    def add_to_list(self, user_id: str, slug: str) -> list[str]:
        eng = self._eng(user_id)
        if slug in eng.my_list:
            eng.my_list.remove(slug)
        eng.my_list.insert(0, slug)
        return eng.my_list

    def remove_from_list(self, user_id: str, slug: str) -> list[str]:
        eng = self._eng(user_id)
        if slug in eng.my_list:
            eng.my_list.remove(slug)
        return eng.my_list

    def my_list(self, user_id: str) -> list[str]:
        return self._eng(user_id).my_list

    # ---- entitlements ---------------------------------------------------
    def refresh_ledger(self) -> None:
        """Fold in ledger rows other services wrote to the shared DB.

        No-op for the in-memory ledger; PersistentLedger implements refresh().
        Called on wallet/playback reads so an admin adjustment is visible
        without restarting core-api.
        """
        refresh = getattr(self.ledger, "refresh", None)
        if refresh is not None:
            refresh()

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

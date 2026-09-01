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

from katha_domain.timeutil import ist_day, now_iso

# Historical rows carry this frozen stamp; every NEW write uses now_iso()
# (admin review #001). Kept for reference/back-compat only.
CLOCK = "2026-09-14T14:03:22+05:30"
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
    updated_at: str = ""


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
                                       language=u.language, created_at=now_iso())

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
    _seen_stamp: dict = {}

    def touch_seen(self, user_id: str, *, ua: str = "", ip: str = "") -> None:
        """Record activity + device for the back office (#020/#021) — at most
        once a minute per user to keep the hot path cheap."""
        if self.shared is None:
            return
        stamp = now_iso()[:16]                      # minute resolution
        if self._seen_stamp.get(user_id) == stamp:
            return
        self._seen_stamp[user_id] = stamp
        self.shared.touch_last_seen(user_id, now_iso())
        if ua:
            self.shared.device_touch(user_id, ua=ua, ip=ip, ts=now_iso())

    def emit(self, user_id: str, name: str, *, ref: str = "", value: int = 0,
             channel: str = "") -> None:
        """Append a product event (admin review #011). Best-effort: analytics
        must never take down a money path, so failures are swallowed."""
        if self.shared is None:
            return
        try:
            self.shared.event_append(ts=now_iso(), user_id=user_id, name=name,
                                     ref=ref, value=value, channel=channel)
        except Exception:
            pass

    def progress_delta(self, user_id: str, episode_id: str, position_ms: int) -> int:
        """Watched-time delta vs the last reported position, clamped to a sane
        step so seeks don't count as watch time (#011 watch minutes)."""
        prev = self._eng(user_id).progress.get(episode_id)
        delta = position_ms - (prev.position_ms if prev else 0)
        return max(0, min(delta, 30_000))

    def kv(self, key: str) -> str | None:
        return self.shared.kv_get(key) if self.shared is not None else None

    def kv_prefix(self, prefix: str) -> dict:
        return self.shared.kv_prefix(prefix) if self.shared is not None else {}

    def refresh_ledger(self) -> None:
        """Fold in ledger rows other services wrote to the shared DB.

        No-op for the in-memory ledger; PersistentLedger implements refresh().
        Called on wallet/playback reads so an admin adjustment is visible
        without restarting core-api.
        """
        refresh = getattr(self.ledger, "refresh", None)
        if refresh is not None:
            refresh()

    def merge_guest(self, guest_id: str, member_id: str) -> dict | None:
        """Fold a guest's coins, entitlements and watch state into the member
        account at login (SAD §8.1). Idempotent via merge ledger keys; the
        guest wallet is zeroed with a clawback so nothing double-spends."""
        from katha_ledger import TxType
        if guest_id == member_id or not (
                guest_id.startswith("gst_") or guest_id == "guest-dev"):
            return None
        self.refresh_ledger()
        bal = self.ledger.balance(guest_id)
        ents = [e for e in self.ledger.entitlements(guest_id)
                if not self.ledger.is_entitled(member_id, e.episode_id)]
        key = f"merge:{guest_id}:{member_id}"
        if bal.balance_bought:
            self.ledger.credit(member_id, TxType.PURCHASE, coins=bal.balance_bought,
                               reference_type="guest_merge", reference_id=guest_id,
                               idempotency_key=f"{key}:bought", created_at=now_iso())
        if bal.balance_bonus:
            self.ledger.credit(member_id, TxType.BONUS, coins=bal.balance_bonus,
                               reference_type="guest_merge", reference_id=guest_id,
                               idempotency_key=f"{key}:bonus", created_at=now_iso())
        if bal.total:
            self.ledger.refund_clawback(guest_id, coins=bal.total,
                                        reference_type="guest_merge",
                                        reference_id=member_id,
                                        idempotency_key=f"{key}:out",
                                        created_at=now_iso())
        for e in ents:
            self.ledger.grant_free(member_id, e.episode_id, created_at=now_iso())
        # watch state: the member keeps their own; gaps fill from the guest
        g, m = self.engagement.pop(guest_id, None), self._eng(member_id)
        if g is not None:
            for eid, item in g.progress.items():
                m.progress.setdefault(eid, item)
            m.order += [e for e in g.order if e not in m.order]
            m.my_list += [s for s in g.my_list if s not in m.my_list]
        self.emit(member_id, "guest_merge", ref=guest_id, value=bal.total)
        return {"coins": bal.total, "episodes": len(ents)}

    def ensure_free(self, user_id: str, slug: str, number: int) -> bool:
        """Grant + report free entitlement for the first N episodes of a series."""
        from .overrides import get_series
        series = get_series(slug)
        if series is None:
            return False
        if number <= series.free_episode_count:
            eid = catalog.episode_id(slug, number)
            if not self.ledger.is_entitled(user_id, eid):
                self.ledger.grant_free(user_id, eid, created_at=now_iso())
            return True
        return False


store = Store()

"""B1/B2: money writes are one locked transaction across workers and services.

Two `PersistentLedger`s over two `Database`s (own event loops, own connections)
stand in for two gunicorn workers or the two services sharing one DB.
"""
import threading

import pytest

from katha_infra import Database, PersistentLedger
from katha_ledger import InsufficientCoins, TxType

TS = "2026-09-01T00:00:00+00:00"


@pytest.fixture
def url(tmp_path):
    return f"sqlite+aiosqlite:///{tmp_path/'atomic.db'}"


def _two_workers(url):
    return PersistentLedger(Database(url)), PersistentLedger(Database(url))


def test_concurrent_unlocks_cannot_both_pass_the_balance_check(url):
    a, b = _two_workers(url)
    a.credit("u", TxType.PURCHASE, coins=60, reference_type="iap",
             reference_id="s", idempotency_key="buy", created_at=TS)
    gate = threading.Barrier(2)
    outcomes: dict[str, str] = {}

    def spend(name, worker, key):
        gate.wait()
        try:
            worker.unlock("u", [f"s:e{key}"], price_per_episode=60,
                          reference_type="episode", reference_id=f"s:e{key}",
                          idempotency_key=f"unlock-{key}", created_at=TS)
            outcomes[name] = "ok"
        except InsufficientCoins:
            outcomes[name] = "insufficient"

    threads = [threading.Thread(target=spend, args=("a", a, 11)),
               threading.Thread(target=spend, args=("b", b, 12))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sorted(outcomes.values()) == ["insufficient", "ok"]
    fresh = PersistentLedger(Database(url))
    assert fresh.balance("u").total == 0                 # never -60
    assert sum(fresh.is_entitled("u", e) for e in ("s:e11", "s:e12")) == 1
    # Both workers' caches agree with the DB.
    assert a.balance("u").total == 0 and b.balance("u").total == 0


def test_same_entitlement_from_two_workers_is_written_once(url):
    a, b = _two_workers(url)
    a.grant_free("u", "s:e1", created_at=TS)
    b.grant_free("u", "s:e1", created_at=TS)             # folds a's row: no collision
    # And b keeps working afterwards for anyone (the old adapter wedged here).
    b.credit("v", TxType.PURCHASE, coins=10, reference_type="iap",
             reference_id="s", idempotency_key="v1", created_at=TS)
    fresh = PersistentLedger(Database(url))
    assert fresh.is_entitled("u", "s:e1")
    assert fresh.balance("v").total == 10 == b.balance("v").total


def test_id_collision_is_retried_once_after_refolding(url, monkeypatch):
    a, b = _two_workers(url)
    a.credit("u1", TxType.PURCHASE, coins=5, reference_type="iap",
             reference_id="s", idempotency_key="a1", created_at=TS)
    # Force the race the lock normally prevents: b's first attempt skips the
    # fold, mints the id a already used, and hits the primary key.
    real_fold, skipped = b._fold, {"n": 0}

    async def fold_once_blind(conn):
        if skipped["n"] == 0:
            skipped["n"] += 1
            return 0
        return await real_fold(conn)

    monkeypatch.setattr(b, "_fold", fold_once_blind)
    b.credit("u2", TxType.PURCHASE, coins=7, reference_type="iap",
             reference_id="s", idempotency_key="b1", created_at=TS)
    fresh = PersistentLedger(Database(url))
    assert fresh.balance("u1").total == 5 and fresh.balance("u2").total == 7
    ids = [t.id for t in fresh.transactions("u1") + fresh.transactions("u2")]
    assert len(set(ids)) == 2
    assert b.balance("u2").total == 7 and len(b.transactions("u2")) == 1


def test_read_refresh_is_incremental_and_sees_other_writers(url):
    a, b = _two_workers(url)
    a.credit("u", TxType.PURCHASE, coins=100, reference_type="iap",
             reference_id="s", idempotency_key="k1", created_at=TS)
    a.grant_free("u", "s:e1", created_at=TS)
    assert b.balance("u").total == 0                     # stale until refresh
    assert b.refresh() == 1
    assert b.balance("u").total == 100 and b.is_entitled("u", "s:e1")
    assert b.refresh() == 0                              # nothing new above the marks

"""Persistence: wallets and entitlements must survive a process restart.

Uses the real persistent adapter over a temp aiosqlite file. A second `Store`
built against the same DB stands in for a restart.
"""
import pytest

from app.store import CLOCK, Store
from katha_ledger import TxType


@pytest.fixture
def persist_env(tmp_path, monkeypatch):
    db_file = tmp_path / "katha_test.db"
    monkeypatch.setenv("KATHA_PERSIST", "1")
    monkeypatch.setenv("KATHA_DB_URL", f"sqlite+aiosqlite:///{db_file}")
    yield


def test_wallet_and_entitlement_survive_restart(persist_env):
    # First "process": buy coins and unlock an episode.
    s1 = Store()
    s1.ledger.credit("u-persist", TxType.PURCHASE, coins=1300, reference_type="iap",
                     reference_id="coins_popular_in", idempotency_key="iap:1", created_at=CLOCK)
    s1.ledger.unlock("u-persist", ["kaanch-ka-mahal:e11"], price_per_episode=30,
                     reference_type="episode", reference_id="kaanch-ka-mahal:e11",
                     idempotency_key="unlock:1", created_at=CLOCK)
    assert s1.ledger.balance("u-persist").total == 1270
    assert s1.ledger.is_entitled("u-persist", "kaanch-ka-mahal:e11")

    # Second "process": a fresh Store over the same DB reloads the ledger state.
    s2 = Store()
    assert s2.ledger.balance("u-persist").total == 1270
    assert s2.ledger.is_entitled("u-persist", "kaanch-ka-mahal:e11")
    # Replaying the persisted log reproduces the projection exactly.
    s2.ledger.reconcile("u-persist")


def test_idempotency_key_persists_across_restart(persist_env):
    s1 = Store()
    s1.ledger.credit("u2", TxType.PURCHASE, coins=600, reference_type="iap",
                     reference_id="coins_starter_in", idempotency_key="dup", created_at=CLOCK)
    s2 = Store()
    # Replaying the same idempotency key after restart appends nothing.
    s2.ledger.credit("u2", TxType.PURCHASE, coins=600, reference_type="iap",
                     reference_id="coins_starter_in", idempotency_key="dup", created_at=CLOCK)
    assert s2.ledger.balance("u2").total == 600

"""Full method-surface coverage for the PersistentLedger adapter.

Exercises every mutation (credit, unlock, grant_free, refund_clawback, admin_adjust)
and every read (balance, is_entitled, transactions, reconcile) against a real temp
SQLite DB, and proves state survives a fresh adapter over the same DB.
"""
import pytest

from katha_infra import PersistentLedger
from katha_infra.db import Database
from katha_ledger import TxType

TS = "2026-09-14T14:03:22+05:30"


@pytest.fixture
def db(tmp_path):
    return Database(f"sqlite+aiosqlite:///{tmp_path/'ledger.db'}")


def test_all_mutations_persist_and_reads_delegate(db):
    L = PersistentLedger(db)
    L.credit("u1", TxType.PURCHASE, coins=1300, reference_type="iap", reference_id="t",
             idempotency_key="p", created_at=TS)
    L.credit("u1", TxType.BONUS, coins=130, reference_type="promo", reference_id="b",
             idempotency_key="bo", created_at=TS)
    L.grant_free("u1", "kaanch-ka-mahal:e1", created_at=TS)
    L.unlock("u1", ["kaanch-ka-mahal:e11"], price_per_episode=30, reference_type="episode",
             reference_id="e11", idempotency_key="u", created_at=TS)
    L.refund_clawback("u1", coins=100, reference_type="iap", reference_id="t",
                      idempotency_key="r", created_at=TS)
    L.admin_adjust("u1", coins=50, reference_type="ticket", reference_id="T1",
                   idempotency_key="a", created_at=TS)

    # reads delegate
    assert L.is_entitled("u1", "kaanch-ka-mahal:e11")
    assert L.is_entitled("u1", "kaanch-ka-mahal:e1")
    # 5 coin transactions (grant_free is an entitlement, not a ledger transaction).
    assert len(L.transactions("u1")) == 5
    w = L.balance("u1")
    # 1300 + 130 - 30(bonus first) - 100(clawback bought) + 50(adjust)
    assert w.total == 1300 + 130 - 30 - 100 + 50
    assert L.reconcile("u1").total == w.total


def test_state_survives_a_fresh_adapter(db):
    L1 = PersistentLedger(db)
    L1.credit("u2", TxType.PURCHASE, coins=600, reference_type="iap", reference_id="t",
              idempotency_key="p", created_at=TS)
    L1.unlock("u2", ["s:e11"], price_per_episode=30, reference_type="episode",
              reference_id="e11", idempotency_key="u", created_at=TS)

    # A brand-new adapter over the same DB rebuilds the exact state from the log.
    L2 = PersistentLedger(db)
    assert L2.balance("u2").total == 570
    assert L2.is_entitled("u2", "s:e11")
    assert L2.reconcile("u2").total == 570

"""SharedStore: the cross-service seam that lets admin-api read/write the same
ledger DB core-api writes. Exercised against a temp SQLite DB."""
import pytest

from katha_infra import Database, PersistentLedger, SharedStore
from katha_ledger import TxType

TS = "2026-09-14T14:03:22+05:30"


@pytest.fixture
def db(tmp_path):
    return Database(f"sqlite+aiosqlite:///{tmp_path/'shared.db'}")


def test_profiles_and_wallets_are_visible_cross_store(db):
    # core-api side: write ledger + profile.
    pl = PersistentLedger(db)
    pl.credit("u1", TxType.PURCHASE, coins=1300, reference_type="web_order",
              reference_id="wo", idempotency_key="web:u1", created_at=TS)
    pl.credit("u1", TxType.BONUS, coins=130, reference_type="web_order",
              reference_id="wo", idempotency_key="webbonus:u1", created_at=TS)
    pl.grant_free("u1", "kaanch-ka-mahal:e1", created_at=TS)

    shared = SharedStore(db)
    shared.upsert_profile("u1", phone="+919888812345", kind="phone", language="hi", created_at=TS)
    shared.upsert_profile("u1", phone="+919888812345", kind="phone")  # idempotent upsert path

    # admin-api side: read it back fresh.
    users = shared.list_users()
    assert len(users) == 1
    u = users[0]
    assert u["user_id"] == "u1"
    assert u["phone"] == "+919888812345"
    assert u["balance_bought"] == 1300 and u["balance_bonus"] == 130
    assert u["total"] == 1430
    assert u["unlocked"] == 1

    assert shared.wallet("u1")["total"] == 1430
    assert len(shared.transactions("u1")) == 2


def test_unknown_user_is_zero(db):
    shared = SharedStore(db)
    assert shared.wallet("nobody")["total"] == 0
    assert shared.transactions("nobody") == []
    assert shared.list_users() == []


def test_admin_adjust_writes_to_the_shared_ledger(db):
    shared = SharedStore(db)
    shared.admin_adjust("u2", coins=100, reason_code="goodwill", ref_id="adj:1", created_at=TS)
    assert shared.wallet("u2")["total"] == 100
    # A new PersistentLedger over the same DB (a fresh core-api) sees the admin credit.
    assert PersistentLedger(db).balance("u2").total == 100

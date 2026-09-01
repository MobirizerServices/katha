"""Cross-service seams: ledger refresh (admin writes visible without restart,
no id collisions), flag overrides reaching /v1/config, channel-split packs."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.store import store
from katha_infra import SharedStore
from katha_infra.db import Database
from katha_infra.persistent_ledger import PersistentLedger
from katha_ledger import Ledger, TxType

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_ledger():
    store.ledger = Ledger()
    yield


def _tmp_db(tmp_path) -> Database:
    return Database(url=f"sqlite+aiosqlite:///{tmp_path}/x.db")


def test_refresh_folds_in_foreign_rows_and_advances_seq(tmp_path):
    db = _tmp_db(tmp_path)
    core = PersistentLedger(db)                       # long-lived core-api ledger
    core.credit("u1", TxType.PURCHASE, coins=100, reference_type="iap",
                reference_id="p1", idempotency_key="k1", created_at="t1")

    # another service (admin-api) writes to the same DB via its own instance
    SharedStore(db=db).admin_adjust("u1", coins=-40, reason_code="refund",
                                    ref_id="adj1", created_at="t2")

    assert core.balance("u1").total == 100            # stale until refresh
    folded = core.refresh()
    assert folded == 1
    assert core.balance("u1").total == 60             # adjustment now visible
    assert core.refresh() == 0                        # idempotent

    # next local write must not collide with the id admin minted
    tx = core.credit("u1", TxType.PURCHASE, coins=5, reference_type="iap",
                     reference_id="p2", idempotency_key="k2", created_at="t3")
    ids = [t.id for t in core.transactions("u1")]
    assert len(ids) == len(set(ids))
    assert tx.id not in ids[:-1]

    # a FRESH instance rebuilt from the DB agrees exactly
    assert PersistentLedger(db).balance("u1").total == 65


def test_refresh_noop_on_in_memory_ledger():
    store.refresh_ledger()                            # in-memory: must not raise
    r = client.get("/v1/wallet", headers={"Authorization": "Bearer fresh-user"})
    assert r.json()["total"] == 0


def test_config_flags_use_shared_defaults():
    flags = client.get("/v1/config").json()["flags"]
    assert flags["rewards.checkin_enabled"] is True
    assert flags["rewards.referral_enabled"] is False
    assert "player.capture_protection" in flags       # full default set served


def test_packs_channel_split():
    app_skus = [p["sku"] for p in client.get("/v1/iap/packs?storefront=IN").json()]
    assert all(not s.startswith("coins_web") for s in app_skus)
    assert "coins_starter_in" in app_skus

    web_skus = [p["sku"] for p in
                client.get("/v1/iap/packs?storefront=IN&channel=web").json()]
    assert web_skus == ["coins_web_popular_in"]

    all_skus = [p["sku"] for p in
                client.get("/v1/iap/packs?storefront=IN&channel=all").json()]
    assert "coins_web_popular_in" in all_skus and "coins_starter_in" in all_skus


def test_shared_store_flags_and_overview(tmp_path):
    db = _tmp_db(tmp_path)
    shared = SharedStore(db=db)

    assert shared.flag_overrides() == {}
    shared.set_flag("rewards.referral_enabled", True)
    shared.set_flag("rewards.referral_enabled", False)     # update path
    shared.set_flag("ai.recs_embeddings", True)
    assert shared.flag_overrides() == {
        "rewards.referral_enabled": False, "ai.recs_embeddings": True}

    # overview counters reflect real ledger + profile rows
    shared.upsert_profile("u9", phone="+911", kind="phone",
                          language="hi", created_at="t0")
    pl = PersistentLedger(db)
    pl.credit("u9", TxType.PURCHASE, coins=600, reference_type="iap",
              reference_id="s1", idempotency_key="pk1", created_at="t1")
    pl.unlock("u9", episode_ids=["s:e11"], price_per_episode=30,
              reference_type="episode", reference_id="s:e11",
              idempotency_key="uk1", created_at="t2")
    st = shared.overview_stats()
    assert st["users"] == 1
    assert st["coins_purchased"] == 600
    assert st["coins_outstanding_bought"] == 570
    assert st["episodes_unlocked"] == 1

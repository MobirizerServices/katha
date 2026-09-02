"""Regression tests for the full-repo review fixes: web orders key on the
payment id, invoice counters are atomic, failed ledger flushes never lose
money rows, DELETE /me erases shared PII, and non-live series neither stream
nor charge."""
import pytest
from fastapi.testclient import TestClient

from app.main import app as core_app
from app.store import store as core_store
from katha_infra import Database, PersistentLedger, SharedStore
from katha_ledger import Ledger, TxType

core = TestClient(core_app)
TS = "2026-09-01T00:00:00+00:00"


@pytest.fixture(autouse=True)
def reset_ledger():
    core_store.ledger = Ledger()
    yield


@pytest.fixture
def shared(tmp_path, monkeypatch):
    sh = SharedStore(Database(f"sqlite+aiosqlite:///{tmp_path/'review.db'}"))
    monkeypatch.setattr(core_store, "shared", sh, raising=False)
    yield sh
    monkeypatch.setattr(core_store, "shared", None, raising=False)


@pytest.fixture
def db(tmp_path):
    return Database(f"sqlite+aiosqlite:///{tmp_path/'ledger.db'}")


# --- web orders: a payment id keys the credit --------------------------------

def test_second_purchase_of_same_pack_credits_again():
    auth = {"Authorization": "Bearer repeat-buyer"}
    first = core.post("/v1/web/orders", headers=auth,
                      json={"sku": "coins_web_popular_in", "order_ref": "pay_001"})
    again = core.post("/v1/web/orders", headers=auth,
                      json={"sku": "coins_web_popular_in", "order_ref": "pay_002"})
    assert again.json()["total"] == 2 * first.json()["total"]
    # A replayed webhook for the SAME payment stays idempotent.
    replay = core.post("/v1/web/orders", headers=auth,
                       json={"sku": "coins_web_popular_in", "order_ref": "pay_002"})
    assert replay.json()["total"] == again.json()["total"]


def test_each_payment_gets_its_own_invoice(shared):
    auth = {"Authorization": "Bearer repeat-inv"}
    for ref in ("pay_a", "pay_b"):
        core.post("/v1/web/orders", headers=auth,
                  json={"sku": "coins_web_popular_in", "email": "r@x.dev",
                        "order_ref": ref})
    invs = core.get("/v1/me/invoices", headers=auth).json()["invoices"]
    assert len(invs) == 2
    assert {i["id"] for i in invs} == {invs[0]["id"], invs[1]["id"]}


# --- invoice counter is atomic ----------------------------------------------

def test_kv_incr_is_sequential_and_survives_first_insert(shared):
    assert shared.kv_incr("invoiceseq:test") == 1
    assert shared.kv_incr("invoiceseq:test") == 2
    shared.kv_set("invoiceseq:seeded", "41")
    assert shared.kv_incr("invoiceseq:seeded") == 42
    assert shared.kv_get("invoiceseq:seeded") == "42"


# --- persistent ledger: money rows survive flush failures --------------------

def test_seq_collision_between_services_remints_and_keeps_both_rows(db):
    a = PersistentLedger(db)
    b = PersistentLedger(db)                     # both loaded at seq 0
    a.credit("u1", TxType.PURCHASE, coins=500, reference_type="iap",
             reference_id="s", idempotency_key="ka", created_at=TS)
    # Reproduce the race: b mints the same seq id in memory (its mutation path
    # normally refreshes first, which only narrows this window), then flushes.
    b._inner.credit("u2", TxType.PURCHASE, coins=100, reference_type="iap",
                    reference_id="s", idempotency_key="kb", created_at=TS)
    b._flush({"u2"})                             # id collision → re-mint + retry
    fresh = PersistentLedger(db)
    assert fresh.balance("u1").total == 500
    assert fresh.balance("u2").total == 100
    ids = {t.id for t in fresh.transactions("u1")} | {t.id for t in fresh.transactions("u2")}
    assert len(ids) == 2


def test_failed_flush_rows_survive_refresh_and_persist_later(db, monkeypatch):
    L = PersistentLedger(db)
    original = L._repo.persist
    calls = {"n": 0}

    def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("db down")
        return original(*args, **kwargs)

    monkeypatch.setattr(L._repo, "persist", flaky)
    with pytest.raises(RuntimeError):
        L.credit("u1", TxType.PURCHASE, coins=500, reference_type="iap",
                 reference_id="s", idempotency_key="k1", created_at=TS)
    # A refresh in between must NOT mark the orphan as on-disk...
    L.refresh()
    # ...so the next mutation's flush persists both rows.
    L.credit("u1", TxType.BONUS, coins=50, reference_type="promo",
             reference_id="b", idempotency_key="k2", created_at=TS)
    assert PersistentLedger(db).balance("u1").total == 550


# --- DELETE /me actually erases ---------------------------------------------

def test_delete_me_scrubs_shared_pii_and_kills_tokens(shared):
    v = core.post("/v1/auth/otp/verify",
                  json={"phone": "+911112223334", "code": "1234"}).json()
    uid, tok = v["user"]["user_id"], v["access_token"]
    assert shared.export_user(uid)["profile"]["phone"] == "+911112223334"

    r = core.delete("/v1/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    prof = shared.export_user(uid)["profile"]
    assert prof["phone"] == "" and prof["kind"] == "erased"
    # The outstanding 30-day JWT died with the deletion.
    assert core.get("/v1/me",
                    headers={"Authorization": f"Bearer {tok}"}).status_code == 401


# --- non-live series neither stream nor charge -------------------------------

def test_archived_series_is_not_playable_or_chargeable(shared):
    auth = {"Authorization": "Bearer archive-u"}
    slug = "kaanch-ka-mahal"
    assert core.post(f"/v1/series/{slug}/episodes/1/playback",
                     headers=auth).status_code == 200
    shared.kv_set(f"status:{slug}", "archived")
    assert core.post(f"/v1/series/{slug}/episodes/1/playback",
                     headers=auth).status_code == 404
    assert core.post(f"/v1/series/{slug}/episodes/11/unlock", headers=auth,
                     json={"idempotency_key": "k1"}).status_code == 404
    assert core.post(f"/v1/series/{slug}/unlock-all", headers=auth,
                     json={"idempotency_key": "k2"}).status_code == 404
    shared.kv_set(f"status:{slug}", "live")
    assert core.post(f"/v1/series/{slug}/episodes/1/playback",
                     headers=auth).status_code == 200

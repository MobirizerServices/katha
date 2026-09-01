"""The admin-review platform build (findings #001–#112 wave 1): real time,
persisted hash-chained audit, user directory search, DPDP tools, refunds,
catalog lifecycle + rating accountability, pack/value overrides, grievances,
health/attention/metrics — exercised end to end across BOTH services against
one temp shared DB.
"""
import json

import pytest
from fastapi.testclient import TestClient

import admin_app.main as admin_main
from admin_app.store import store as admin_store
from app.main import app as core_app
from app.store import store as core_store
from katha_infra import Database, PersistentLedger, SharedStore
from katha_ledger import Ledger, TxType

core = TestClient(core_app)
admin = TestClient(admin_main.app)

ADMIN = {"X-Actor-Id": "riya", "X-Role": "admin"}
FINANCE = {"X-Actor-Id": "farah", "X-Role": "finance"}
SUPPORT = {"X-Actor-Id": "sam", "X-Role": "support"}
QC = {"X-Actor-Id": "dev", "X-Role": "qc"}
T0 = "2026-09-01T00:00:00+00:00"


@pytest.fixture
def shared(tmp_path, monkeypatch):
    db = Database(f"sqlite+aiosqlite:///{tmp_path/'platform.db'}")
    sh = SharedStore(db)
    monkeypatch.setattr(admin_main, "SHARED", sh)
    monkeypatch.setattr(core_store, "shared", sh, raising=False)
    admin_store.ledger = Ledger()
    admin_store.audit.clear()
    admin_store.approvals.clear()
    admin_store.flag_overrides.clear()
    core_store.ledger = Ledger()
    yield sh
    monkeypatch.setattr(core_store, "shared", None, raising=False)


# ---- SharedStore unit surface ----------------------------------------------

def test_search_users_filters_sorts_segments(shared):
    for i, (uid, phone, kind, bought) in enumerate([
        ("u_a", "+9111", "phone", 500), ("u_b", "", "guest", 0),
        ("u_c", "+9122", "phone", 100)]):
        shared.upsert_profile(uid, phone=phone, kind=kind, language="hi", created_at=T0)
    pl = PersistentLedger(shared.db)
    pl.credit("u_a", TxType.PURCHASE, coins=500, reference_type="iap",
              reference_id="s", idempotency_key="k1", created_at=T0)
    pl.credit("u_c", TxType.PURCHASE, coins=100, reference_type="iap",
              reference_id="s", idempotency_key="k2", created_at=T0)
    shared.touch_last_seen("u_c", "2026-09-02T00:00:00+00:00")

    page = shared.search_users(q="u_", limit=2, offset=0, sort="balance")
    assert page["total"] == 3 and len(page["users"]) == 2
    assert page["users"][0]["user_id"] == "u_a"          # highest balance first

    assert shared.search_users(q="+9122")["users"][0]["user_id"] == "u_c"
    assert {u["user_id"] for u in shared.search_users(segment="guests")["users"]} == {"u_b"}
    assert {u["user_id"] for u in shared.search_users(segment="members")["users"]} == {"u_a", "u_c"}
    payers = {u["user_id"] for u in shared.search_users(segment="payers")["users"]}
    assert payers == {"u_a", "u_c"}
    recent = shared.search_users(sort="recent")["users"]
    assert recent[0]["user_id"] == "u_c"                 # only one ever seen
    assert shared.search_users(sort="unlocked")["total"] == 3


def test_kv_roundtrip_and_prefix(shared):
    assert shared.kv_get("x") is None
    shared.kv_set("pack:starter", "{\"coins\": 700}")
    shared.kv_set("pack:starter", "{\"coins\": 800}")     # update path
    shared.kv_set("rating:s1", "{\"value\": \"A\"}")
    assert shared.kv_get("pack:starter") == "{\"coins\": 800}"
    assert shared.kv_prefix("pack:") == {"starter": "{\"coins\": 800}"}


def test_audit_chain_appends_and_verifies(shared):
    a = shared.audit_append(ts=T0, actor_id="riya", actor_role="admin",
                            action="t.one", target="x", detail="a=1")
    b = shared.audit_append(ts=T0, actor_id="sam", actor_role="support",
                            action="t.two", target="y", detail="b=2", ip="1.2.3.4")
    assert a["id"] < b["id"]
    out = shared.audit_list(limit=10)
    assert out["chain_ok"] is True and out["total"] == 2
    assert out["rows"][0]["action"] == "t.two" and out["rows"][0]["ip"] == "1.2.3.4"
    assert shared.audit_list(actor="riya")["rows"][0]["actor"] == "riya"
    assert shared.audit_list(q="t.one")["rows"][0]["action"] == "t.one"
    assert shared.audit_list(before_id=b["id"])["rows"][0]["action"] == "t.one"


def test_grievance_lifecycle_store(shared):
    shared.grievance_create(gid="G-1", user_id="u1", contact="a@b.c", channel="app",
                            subject="coins missing", body="paid, no coins",
                            created_at=T0)
    assert shared.grievance_list("new")[0]["id"] == "G-1"
    assert shared.grievance_update("G-404", status="ack") is None
    shared.grievance_update("G-1", status="ack", ack_at=T0, assignee="sam")
    shared.grievance_update("G-1", add_note={"by": "sam", "note": "checking"})
    g = shared.grievance_list()[0]
    assert g["status"] == "ack" and g["assignee"] == "sam" and len(g["notes"]) == 1


def test_export_refund_erase_store(shared):
    shared.upsert_profile("u9", phone="+91999", kind="phone", language="ta", created_at=T0)
    pl = PersistentLedger(shared.db)
    tx = pl.credit("u9", TxType.PURCHASE, coins=600, reference_type="iap",
                   reference_id="coins_starter_in", idempotency_key="p1", created_at=T0)
    bundle = shared.export_user("u9")
    assert bundle["profile"]["phone"] == "+91999"
    assert bundle["transactions"][0]["type"] == "purchase"
    assert shared.find_transaction("u9", tx.id)["amount_bought"] == 600
    assert shared.find_transaction("u9", "ctx_nope") is None
    assert shared.find_transaction("other", tx.id) is None
    w = shared.refund("u9", coins=600, reference_id=tx.id, ref_key=f"r:{tx.id}",
                      created_at=T0)
    assert w["total"] == 0
    assert shared.erase_user("u9", T0) is True
    assert shared.erase_user("missing", T0) is False
    assert shared.export_user("u9")["profile"]["kind"] == "erased"
    assert shared.export_user("nobody")["profile"] == {}


# ---- admin endpoints against the shared DB ---------------------------------

def test_users_endpoint_search_and_masking(shared):
    shared.upsert_profile("u_m", phone="+919876500000", kind="phone",
                          language="hi", created_at=T0)
    full = admin.get("/admin/v1/users?q=u_m", headers=SUPPORT).json()
    assert full["total"] == 1 and full["users"][0]["phone"] == "+919876500000"
    masked = admin.get("/admin/v1/users?q=u_m", headers=FINANCE).json()
    assert masked["users"][0]["phone"] == "•••• masked"   # server-side PII (#078)
    assert full["users"][0]["lastActive"] == "never"


def test_refund_endpoint_flow(shared):
    pl = PersistentLedger(shared.db)
    tx = pl.credit("u_r", TxType.PURCHASE, coins=600, reference_type="iap",
                   reference_id="coins_starter_in", idempotency_key="pr", created_at=T0)
    ul = pl.unlock("u_r", episode_ids=["s:e11"], price_per_episode=30,
                   reference_type="episode", reference_id="s:e11",
                   idempotency_key="ur", created_at=T0)
    assert admin.post("/admin/v1/wallet/refund", headers=SUPPORT,
                      json={"user_id": "u_r"}).status_code == 400
    assert admin.post("/admin/v1/wallet/refund", headers=SUPPORT,
                      json={"user_id": "u_r", "tx_id": "nope"}).status_code == 404
    unlock_tx = [t for t in shared.transactions("u_r") if t.type == TxType.UNLOCK][0]
    assert admin.post("/admin/v1/wallet/refund", headers=SUPPORT,
                      json={"user_id": "u_r", "tx_id": unlock_tx.id}).status_code == 409
    r = admin.post("/admin/v1/wallet/refund", headers=FINANCE,
                   json={"user_id": "u_r", "tx_id": tx.id})
    assert r.status_code == 200 and r.json()["coins"] == 600
    assert r.json()["wallet"]["total"] == -30             # clawback can go negative
    rows = shared.audit_list(q="wallet.refund")["rows"]
    assert rows and rows[0]["entity"] == "u_r"


def test_dpdp_endpoints_and_timeline(shared):
    shared.upsert_profile("u_d", phone="+9155", kind="phone", language="hi", created_at=T0)
    PersistentLedger(shared.db).credit("u_d", TxType.PURCHASE, coins=100,
                                       reference_type="iap", reference_id="x",
                                       idempotency_key="d1", created_at=T0)
    admin.post("/admin/v1/wallet/adjust", headers=SUPPORT,
               json={"user_id": "u_d", "coins": 10, "reason_code": "goodwill"})
    tl = admin.get("/admin/v1/users/u_d/timeline", headers=SUPPORT).json()
    kinds = {e["kind"] for e in tl["events"]}
    assert kinds == {"ledger", "admin"}
    ents = admin.get("/admin/v1/users/u_d/entitlements", headers=SUPPORT).json()
    assert ents["entitlements"] == []
    assert admin.get("/admin/v1/users/u_d/export", headers=SUPPORT).status_code == 403
    exp = admin.get("/admin/v1/users/u_d/export", headers=ADMIN)
    assert exp.status_code == 200 and exp.json()["profile"]["phone"] == "+9155"
    assert admin.post("/admin/v1/users/ghost/erase", headers=ADMIN).status_code == 404
    assert admin.post("/admin/v1/users/u_d/erase", headers=ADMIN).json()["status"] == "erased"


def test_catalog_lifecycle_reaches_core(shared):
    # takedown requires a reason; QC can only archive
    assert admin.post("/admin/v1/catalog/series/kaanch-ka-mahal/status",
                      headers=ADMIN, json={"status": "weird"}).status_code == 400
    assert admin.post("/admin/v1/catalog/series/kaanch-ka-mahal/status",
                      headers=QC, json={"status": "draft"}).status_code == 403
    assert admin.post("/admin/v1/catalog/series/kaanch-ka-mahal/status",
                      headers=ADMIN, json={"status": "archived"}).status_code == 400
    assert admin.post("/admin/v1/catalog/series/nope/status",
                      headers=ADMIN, json={"status": "live"}).status_code == 404
    ok = admin.post("/admin/v1/catalog/series/kaanch-ka-mahal/status",
                    headers=QC, json={"status": "archived", "reason": "G-1 takedown"})
    assert ok.status_code == 200

    slugs = [s["slug"] for s in core.get("/v1/series").json()]
    assert "kaanch-ka-mahal" not in slugs                 # hidden from the apps (#035)
    assert core.get("/v1/series/kaanch-ka-mahal").status_code == 404
    assert len(core.get("/v1/home").json()["rows"][0]["series"]) > 0

    admin.post("/admin/v1/catalog/series/kaanch-ka-mahal/status",
               headers=ADMIN, json={"status": "live"})
    assert core.get("/v1/series/kaanch-ka-mahal").status_code == 200


def test_rating_accountability_reaches_core(shared):
    assert admin.patch("/admin/v1/catalog/series/kaanch-ka-mahal/rating",
                       headers=QC, json={"rating": "X"}).status_code == 400
    assert admin.patch("/admin/v1/catalog/series/kaanch-ka-mahal/rating",
                       headers=QC, json={"rating": "A"}).status_code == 400  # no reason
    assert admin.patch("/admin/v1/catalog/series/ghost/rating",
                       headers=QC, json={"rating": "A", "reason": "x"}).status_code == 404
    r = admin.patch("/admin/v1/catalog/series/kaanch-ka-mahal/rating",
                    headers=QC, json={"rating": "U/A 16+", "reason": "episode 41 violence"})
    assert r.json()["rating"]["by"] == "dev"
    assert core.get("/v1/series/kaanch-ka-mahal").json()["content_rating"] == "U/A 16+"
    detail = admin.get("/admin/v1/catalog/series/kaanch-ka-mahal", headers=QC).json()
    assert detail["rating"] == "U/A 16+" and detail["ratingHistory"]["reason"]
    assert detail["media"]["episodes_with_media"] >= 0
    assert admin.get("/admin/v1/catalog/series/ghost", headers=QC).status_code == 404


def test_pack_and_version_overrides_reach_core(shared):
    assert admin.patch("/admin/v1/config/packs/coins_starter_in", headers=FINANCE,
                       json={"coins": 700}).status_code == 428      # typed confirm (#059)
    assert admin.patch("/admin/v1/config/packs/nope", headers=FINANCE,
                       json={"confirm": "nope"}).status_code == 404
    assert admin.patch("/admin/v1/config/packs/coins_starter_in", headers=FINANCE,
                       json={"confirm": "coins_starter_in", "coins": -1}).status_code == 400
    ok = admin.patch("/admin/v1/config/packs/coins_starter_in", headers=FINANCE,
                     json={"confirm": "coins_starter_in", "coins": 700, "bonus": 50})
    assert ok.status_code == 200
    packs = {p["sku"]: p for p in core.get("/v1/iap/packs?storefront=IN").json()}
    assert packs["coins_starter_in"]["coins"] == 700      # core sells the override
    assert packs["coins_starter_in"]["bonus_coins"] == 50
    listed = {p["sku"]: p for p in admin.get("/admin/v1/config/packs",
                                             headers=FINANCE).json()}
    assert listed["coins_starter_in"]["coins"] == 700

    assert admin.patch("/admin/v1/config/values/app.min_version", headers=ADMIN,
                       json={"value": ""}).status_code == 400
    admin.patch("/admin/v1/config/values/app.min_version", headers=ADMIN,
                json={"value": "1.2.0"})
    assert core.get("/v1/config").json()["min_app_version"] == "1.2.0"
    assert admin.get("/admin/v1/config/policy", headers=FINANCE).json()[
        "min_app_version"] == "1.2.0"


def test_guarded_flag_requires_typed_confirm(shared):
    r = admin.patch("/admin/v1/config/flags/store.web_enabled", headers=ADMIN,
                    json={"enabled": False})
    assert r.status_code == 428
    r = admin.patch("/admin/v1/config/flags/store.web_enabled", headers=ADMIN,
                    json={"enabled": False, "confirm": "store.web_enabled"})
    assert r.status_code == 200
    assert core.get("/v1/config").json()["flags"]["store.web_enabled"] is False
    flags = {f["key"]: f for f in admin.get("/admin/v1/config/flags",
                                            headers=ADMIN).json()}
    assert flags["store.web_enabled"]["guarded"] is True
    assert flags["store.web_enabled"]["owner"] == "payments"


def test_grievance_end_to_end(shared):
    assert core.post("/v1/grievance", json={"contact": "", "subject": "x"},
                     headers={"Authorization": "Bearer u_g"}).status_code == 400
    filed = core.post("/v1/grievance",
                      json={"contact": "a@b.c", "subject": "double charge",
                            "body": "charged twice", "channel": "app"},
                      headers={"Authorization": "Bearer u_g"})
    gid = filed.json()["id"]
    assert filed.json()["status"] == "new"

    q = admin.get("/admin/v1/grievances", headers=SUPPORT).json()["grievances"]
    assert q[0]["id"] == gid and q[0]["ack_breach"] is False
    assert admin.post(f"/admin/v1/grievances/{gid}/resolve", headers=SUPPORT,
                      json={}).status_code == 400          # note required
    assert admin.post("/admin/v1/grievances/G-NOPE/ack",
                      headers=SUPPORT).status_code == 404
    admin.post(f"/admin/v1/grievances/{gid}/ack", headers=SUPPORT)
    done = admin.post(f"/admin/v1/grievances/{gid}/resolve", headers=SUPPORT,
                      json={"note": "refunded the duplicate"})
    assert done.json()["status"] == "resolved"
    rows = shared.audit_list(q="grievance")["rows"]
    assert {r["action"] for r in rows} == {"grievance.ack", "grievance.resolve"}


def test_attention_and_overview_signals(shared):
    admin.post("/admin/v1/wallet/adjust", headers=SUPPORT,
               json={"user_id": "u_x", "coins": 900, "reason_code": "refund"})
    shared.grievance_create(gid="G-OLD", user_id="", contact="c", channel="web",
                            subject="ignored", body="",
                            created_at="2026-08-20T00:00:00+00:00")  # 12 days ago
    items = admin.get("/admin/v1/attention", headers=SUPPORT).json()["items"]
    ids = {i["id"] for i in items}
    assert "approvals" in ids and "G-OLD" in ids
    body = admin.get("/admin/v1/overview", headers=ADMIN).json()
    assert body["generated_at"] and isinstance(body["attention"], list)


def test_health_metrics_matrix(shared):
    h = admin.get("/admin/v1/health/full").json()
    assert h["checks"]["database"] == "ok"
    assert h["status"] in ("ok", "degraded", "down")
    m = admin.get("/admin/v1/metrics").json()
    assert any("/admin/v1/health/full" in k for k in m)
    mx = admin.get("/admin/v1/access/matrix", headers=SUPPORT).json()
    assert any(row["capability"].startswith("Coin adjustment") for row in mx["matrix"])


def test_approvals_history_and_context(shared):
    admin.post("/admin/v1/wallet/adjust", headers=SUPPORT,
               json={"user_id": "u_h", "coins": 800, "reason_code": "refund"})
    pending = admin.get("/admin/v1/approvals", headers=FINANCE).json()
    assert pending[0]["balanceBefore"] == 0 and pending[0]["balanceAfter"] == 800
    assert pending[0]["requesterToday"] == 1
    ap_id = pending[0]["id"]
    admin.post(f"/admin/v1/approvals/{ap_id}/reject", headers=FINANCE,
               json={"note": "no"})
    assert admin.get("/admin/v1/approvals", headers=FINANCE).json() == []
    hist = admin.get("/admin/v1/approvals?status=all", headers=FINANCE).json()
    assert hist[0]["status"] == "rejected"
    assert admin.get("/admin/v1/approvals?status=rejected",
                     headers=FINANCE).json()[0]["id"] == ap_id


def test_adjust_bounds_and_ref(shared):
    assert admin.post("/admin/v1/wallet/adjust", headers=SUPPORT,
                      json={"user_id": "u_z", "coins": 200_000,
                            "reason_code": "x"}).status_code == 400
    r = admin.post("/admin/v1/wallet/adjust", headers=SUPPORT,
                   json={"user_id": "u_z", "coins": 40, "reason_code": "goodwill"})
    assert r.json()["ref"].startswith("adjust:")           # UI reconciliation (#026)


def test_last_seen_touch_via_core(shared):
    shared.upsert_profile("u_seen", phone="", kind="guest", language="hi", created_at=T0)
    core.get("/v1/wallet", headers={"Authorization": "Bearer u_seen"})
    seen = shared.search_users(q="u_seen")["users"][0]["last_seen"]
    assert seen != ""                                       # #020


def test_oidc_directory_persists_in_shared_kv(shared):
    """Provisioning lives in the shared DB: grant via the API → adminuser: KV
    row; revoke leaves a tombstone that never resurrects the bootstrap seed."""
    from admin_app import oidc

    admin_client = TestClient(admin_main.app)
    ADMIN = {"X-Actor-Id": "root@katha.dev", "X-Role": "admin"}
    r = admin_client.put("/admin/v1/access/users/riya@katha.dev",
                         headers=ADMIN, json={"role": "support"})
    assert r.status_code == 200
    row = json.loads(shared.kv_get("adminuser:riya@katha.dev"))
    assert row["role"] == "support" and row["by"] == "root@katha.dev"
    assert oidc.directory_role("riya@katha.dev") == "support"

    # a second admin so the revoke below is not "the last admin"
    admin_client.put("/admin/v1/access/users/lead@katha.dev", headers=ADMIN,
                     json={"role": "admin", "confirm": "lead@katha.dev"})
    assert admin_client.delete("/admin/v1/access/users/riya@katha.dev",
                               headers=ADMIN).status_code == 200
    assert oidc.directory_role("riya@katha.dev") is None
    assert json.loads(shared.kv_get("adminuser:riya@katha.dev"))["role"] == ""
    # the tombstone survives later reads — a revoked operator never comes back
    active = {e for e, v in oidc.directory_all().items() if v.get("role")}
    assert "riya@katha.dev" not in active and "lead@katha.dev" in active

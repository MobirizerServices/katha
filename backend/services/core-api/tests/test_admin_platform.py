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


# ===== the pending-findings wave: events, analytics, caps, catalog levers ====

CORE = None  # per-test TestClient over core_app (fixture-fresh shared store)


def _core():
    return TestClient(core_app)


def _admin():
    return TestClient(admin_main.app)


ADMIN_H = {"X-Actor-Id": "root@katha.dev", "X-Role": "admin"}
FIN_H = {"X-Actor-Id": "farah", "X-Role": "finance"}


def test_events_emitted_by_core_paths(shared):
    core = _core()
    # locked playback (no coins) → paywall_view; free episode → play_start
    r = core.post("/v1/series/kaanch-ka-mahal/episodes/11/playback",
                  headers={"Authorization": "Bearer ev-user"})
    assert r.json()["locked"] is True
    core.post("/v1/series/kaanch-ka-mahal/episodes/1/playback",
              headers={"Authorization": "Bearer ev-user"})
    core.post("/v1/iap/verify", headers={"Authorization": "Bearer ev-user"},
              json={"sku": "coins_starter_in", "jws": "sig1"})
    core.post("/v1/series/kaanch-ka-mahal/episodes/11/unlock",
              headers={"Authorization": "Bearer ev-user"},
              json={"idempotency_key": "ev-unlock-1"})
    core.put("/v1/progress", headers={"Authorization": "Bearer ev-user"},
             json={"items": [{"slug": "kaanch-ka-mahal", "number": 1,
                              "position_ms": 9000, "duration_ms": 120000}]})
    from katha_domain.timeutil import now_iso
    a = shared.analytics(now=now_iso(), days=3)   # live clock — events are stamped live
    today = a["daily"][-1]
    assert today["paywall_views"] == 1 and today["purchases"] == 1
    assert today["unlocks"] == 1 and today["dau"] == 1
    assert today["watch_minutes"] == 0  # 9s clamps below one minute but counts
    assert a["funnel"]["30d"] == {"paywall_view": 1, "purchase": 1, "unlock": 1}


def test_analytics_windows_split_and_refund_ratio(shared):
    # Live timestamps: "today"/30d are real calendar windows — frozen dates
    # made this test rot at midnight.
    from datetime import datetime, timedelta, timezone
    from katha_domain.timeutil import now_iso
    today = now_iso()
    pl = PersistentLedger(shared.db)
    old = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    pl.credit("w1", TxType.PURCHASE, coins=1000, reference_type="iap",
              reference_id="s", idempotency_key="an1", created_at=old)
    pl.credit("w2", TxType.PURCHASE, coins=500, reference_type="web_order",
              reference_id="s", idempotency_key="an2", created_at=today)
    pl.refund_clawback("w2", coins=100, reference_type="gateway_refund",
                       reference_id="rf", idempotency_key="an3", created_at=today)
    r = _admin().get("/admin/v1/analytics", headers=ADMIN_H)
    assert r.status_code == 200
    a = r.json()
    t = a["windows"]["today"]["current"]
    assert t["coins_purchased"] == 500 and t["coins_web"] == 500
    assert t["coins_refunded"] == 100 and t["refund_ratio_pct"] == 20.0
    m = a["windows"]["30d"]["current"]
    assert m["coins_purchased"] == 1500 and m["coins_iap"] == 1000
    assert len(a["spark"]["coins_purchased"]) == 30
    assert len(a["outstanding_trend"]) == 30
    # 1000 + 500 - 100 clawback = 1400 coins of liability
    assert a["outstanding_trend"][-1] == 1400
    assert a["outstanding_rupees"] == round(1400 * 0.15)


def test_adjust_daily_cap(shared):
    shared.kv_set("config:adjust.daily_cap", "100")
    a = _admin()
    r = a.post("/admin/v1/wallet/adjust", headers=ADMIN_H,
               json={"user_id": "cap-u", "coins": 85, "reason_code": "goodwill"})
    assert r.status_code == 200
    r = a.post("/admin/v1/wallet/adjust", headers=ADMIN_H,
               json={"user_id": "cap-u", "coins": 60, "reason_code": "goodwill"})
    assert r.status_code == 409 and "daily adjustment cap" in r.json()["detail"]
    # attention shows the cap warning at >=80%
    items = a.get("/admin/v1/attention", headers=ADMIN_H).json()["items"]
    assert any(i["id"] == "cap:root@katha.dev" for i in items)


def test_series_pricing_override_reaches_money(shared):
    a = _admin()
    r = a.patch("/admin/v1/catalog/series/kaanch-ka-mahal/pricing", headers=FIN_H,
                json={"coin_price": 40, "free_episodes": 5, "confirm": "kaanch-ka-mahal"})
    assert r.status_code == 200
    core = _core()
    d = core.get("/v1/series/kaanch-ka-mahal").json()
    assert d["episode_coin_price"] == 40 and d["free_episode_count"] == 5
    # e6 is now paid (free window shrank) and the ledger charges 40
    core.post("/v1/iap/verify", headers={"Authorization": "Bearer price-u"},
              json={"sku": "coins_starter_in", "jws": "sig-price"})
    r = core.post("/v1/series/kaanch-ka-mahal/episodes/6/unlock",
                  headers={"Authorization": "Bearer price-u"},
                  json={"idempotency_key": "pr-1"})
    assert r.status_code == 200
    assert r.json()["wallet"]["total"] == 560   # 600 bought - the overridden 40
    # panel shows the override marker
    det = a.get("/admin/v1/catalog/series/kaanch-ka-mahal", headers=ADMIN_H).json()
    assert det["pricingOverridden"] is True and det["coinPrice"] == 40
    assert det["episodes"][5]["isFree"] is False


def test_create_series_draft_to_live(shared):
    a = _admin()
    r = a.post("/admin/v1/catalog/series", headers=ADMIN_H,
               json={"slug": "naya-safar", "title": "Naya Safar",
                     "episode_count": 2, "free_episodes": 1, "coin_price": 25})
    assert r.status_code == 200 and r.json()["status"] == "draft"
    # bad slugs and dupes refused
    assert a.post("/admin/v1/catalog/series", headers=ADMIN_H,
                  json={"slug": "X!", "title": "t", "episode_count": 1}).status_code == 400
    assert a.post("/admin/v1/catalog/series", headers=ADMIN_H,
                  json={"slug": "naya-safar", "title": "t",
                        "episode_count": 1}).status_code == 409
    # in the admin list as draft; NOT in the public catalog yet
    rows = a.get("/admin/v1/catalog/series", headers=ADMIN_H).json()
    mine = next(x for x in rows if x["slug"] == "naya-safar")
    assert mine["status"] == "draft"
    core = _core()
    assert "naya-safar" not in [s["slug"] for s in core.get("/v1/series").json()]
    # flip live → served, free e1 plays, e2 asks 25 coins
    a.post("/admin/v1/catalog/series/naya-safar/status", headers=ADMIN_H,
           json={"status": "live"})
    assert "naya-safar" in [s["slug"] for s in core.get("/v1/series").json()]
    p1 = core.post("/v1/series/naya-safar/episodes/1/playback",
                   headers={"Authorization": "Bearer ns-u"}).json()
    assert p1["locked"] is False
    p2 = core.post("/v1/series/naya-safar/episodes/2/playback",
                   headers={"Authorization": "Bearer ns-u"}).json()
    assert p2["locked"] is True and p2["price_coins"] == 25


def test_episode_retitle_and_rights_attention(shared):
    a = _admin()
    r = a.patch("/admin/v1/catalog/series/kaanch-ka-mahal/episodes/2",
                headers=ADMIN_H, json={"title": "The Second Face"})
    assert r.status_code == 200
    det = a.get("/admin/v1/catalog/series/kaanch-ka-mahal", headers=ADMIN_H).json()
    assert det["episodes"][1]["title"] == "The Second Face"
    # the public catalog serves the retitle too
    core_det = _core().get("/v1/series/kaanch-ka-mahal").json()
    assert core_det["episodes"][1]["title"] == "The Second Face"
    # rights with an imminent expiry → attention warn
    r = a.patch("/admin/v1/catalog/series/kaanch-ka-mahal/rights", headers=ADMIN_H,
                json={"owner": "Studio X", "license_until": "2026-09-10"})
    assert r.status_code == 200
    assert a.patch("/admin/v1/catalog/series/kaanch-ka-mahal/rights",
                   headers=ADMIN_H,
                   json={"license_until": "not-a-date"}).status_code == 400
    items = a.get("/admin/v1/attention", headers=ADMIN_H).json()["items"]
    lic = next(i for i in items if i["id"] == "license:kaanch-ka-mahal")
    assert "Studio X" in lic["detail"]


def test_flag_pct_rollout_and_experiments(shared):
    from katha_domain.flags import bucket
    a = _admin()
    r = a.patch("/admin/v1/config/flags/rewards.referral_enabled", headers=ADMIN_H,
                json={"enabled": True, "pct": 50})
    assert r.status_code == 200 and r.json()["pct"] == 50
    flags = {f["key"]: f for f in
             a.get("/admin/v1/config/flags", headers=ADMIN_H).json()}
    assert flags["rewards.referral_enabled"]["pct"] == 50
    # pick users on both sides of the bucket boundary
    inside = next(f"u{i}" for i in range(200)
                  if bucket("rewards.referral_enabled", f"u{i}") < 50)
    outside = next(f"u{i}" for i in range(200)
                   if bucket("rewards.referral_enabled", f"u{i}") >= 50)
    core = _core()
    fin = core.get("/v1/config", headers={"Authorization": f"Bearer {inside}"}).json()
    fout = core.get("/v1/config", headers={"Authorization": f"Bearer {outside}"}).json()
    assert fin["flags"]["rewards.referral_enabled"] is True
    assert fout["flags"]["rewards.referral_enabled"] is False
    assert core.get("/v1/config").json()["flags"]["rewards.referral_enabled"] is False
    # experiments: register + running assignment is stable per user
    r = a.put("/admin/v1/experiments/free-count", headers=ADMIN_H,
              json={"hypothesis": "8 free episodes converts better",
                    "variants": [{"name": "control", "pct": 50},
                                 {"name": "eight", "pct": 50}],
                    "status": "running"})
    assert r.status_code == 200
    assert a.put("/admin/v1/experiments/free-count", headers=ADMIN_H,
                 json={"variants": [{"name": "x", "pct": 200}],
                       "status": "running"}).status_code == 400
    got = [core.get("/v1/config",
                    headers={"Authorization": "Bearer exp-u"}).json()["experiments"]
           for _ in range(2)]
    assert got[0] == got[1] and got[0]["free-count"] in ("control", "eight")
    listed = a.get("/admin/v1/experiments", headers=ADMIN_H).json()["experiments"]
    assert listed[0]["key"] == "free-count" and listed[0]["status"] == "running"


def test_devices_recorded_and_signout_all(shared):
    core = _core()
    r = core.post("/v1/auth/guest")
    token = r.json()["access_token"]
    uid = r.json()["user"]["user_id"]
    core.get("/v1/wallet", headers={"Authorization": f"Bearer {token}",
                                    "User-Agent": "KathaApp/1.0 (iPhone16)"})
    a = _admin()
    devs = a.get(f"/admin/v1/users/{uid}/devices", headers=ADMIN_H).json()["devices"]
    assert devs and devs[0]["ua"].startswith("KathaApp/1.0")
    # sign out everywhere: the old JWT dies on the next request
    r = a.post(f"/admin/v1/users/{uid}/signout-devices", headers=ADMIN_H)
    assert r.status_code == 200 and r.json()["token_version"] == 1
    core.store = None  # noqa - clarity only
    r = core.get("/v1/wallet", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
    # a fresh sign-in works and carries the new version
    token2 = core.post("/v1/auth/otp/verify",
                       json={"phone": "+911234509876", "code": "0000"}).json()
    assert core.get("/v1/wallet",
                    headers={"Authorization": f"Bearer {token2['access_token']}"}
                    ).status_code == 200
    assert a.post("/admin/v1/users/ghost-none/signout-devices",
                  headers=ADMIN_H).status_code == 404


def test_attention_ack_and_webhook(shared, monkeypatch):
    sent = []

    class _Resp:
        status = 200
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def read(self):
            return b"{}"

    def fake_urlopen(req, timeout=0):
        url = req if isinstance(req, str) else req.full_url
        if "hooks.example" in url:
            sent.append(json.loads(req.data))
        return _Resp()

    import urllib.request as _ur
    monkeypatch.setattr(_ur, "urlopen", fake_urlopen)
    monkeypatch.setenv("KATHA_ALERT_WEBHOOK", "https://hooks.example/alert")
    a = _admin()
    # a pending approval notifies the webhook (#053)
    r = a.post("/admin/v1/wallet/adjust", headers=ADMIN_H,
               json={"user_id": "hook-u", "coins": 900, "reason_code": "goodwill"})
    assert r.status_code == 200 and r.json()["status"] == "pending_approval"
    assert sent and "approval" in sent[0]["text"]
    # a breached grievance (danger) mirrors once, not twice (#111)
    shared.grievance_create(gid="G-HOOK1", user_id="u", contact="x@y", channel="app",
                            subject="stuck payment", body="",
                            created_at="2026-08-20T00:00:00+00:00")
    before = len(sent)
    a.get("/admin/v1/attention", headers=ADMIN_H)
    a.get("/admin/v1/attention", headers=ADMIN_H)
    assert len(sent) == before + 1
    # acknowledge → the item carries the owner (#016)
    r = a.post("/admin/v1/attention/G-HOOK1/ack", headers=ADMIN_H)
    assert r.status_code == 200
    items = a.get("/admin/v1/attention", headers=ADMIN_H).json()["items"]
    g = next(i for i in items if i["id"] == "G-HOOK1")
    assert g["ack"]["by"] == "root@katha.dev"


def test_rupee_rate_and_ui_metrics(shared):
    shared.kv_set("config:coin.rupee_rate", "0.2")
    a = _admin()
    pol = a.get("/admin/v1/config/policy", headers=ADMIN_H).json()
    assert pol["coin_rupee_rate"] == 0.2
    assert pol["adjust_daily_cap"] == 2000
    assert pol["retention"]["events_days"] == 365
    assert a.post("/admin/v1/metrics/ui", headers=ADMIN_H,
                  json={"view": "overview"}).json() == {"ok": True}
    assert a.get("/admin/v1/metrics").json()["ui"]["overview"] >= 1


def test_rate_limit_trips(shared, monkeypatch):
    monkeypatch.setenv("KATHA_ADMIN_RATE_LIMIT", "3")
    admin_main.RATE_BUCKETS.clear()
    a = _admin()
    H = {"X-Actor-Id": "hammer", "X-Role": "admin"}
    codes = [a.post("/admin/v1/metrics/ui", headers=H,
                    json={"view": "x"}).status_code for _ in range(5)]
    assert codes[:3] == [200, 200, 200] and 429 in codes[3:]
    admin_main.RATE_BUCKETS.clear()


def test_security_headers_present(shared):
    r = _admin().get("/admin/v1/config/policy", headers=ADMIN_H)
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Content-Security-Policy"] == "default-src 'none'"


def test_platform_error_paths(shared):
    a = _admin()
    # pricing: confirm + bounds
    assert a.patch("/admin/v1/catalog/series/kaanch-ka-mahal/pricing",
                   headers=FIN_H, json={"coin_price": 40}).status_code == 428
    assert a.patch("/admin/v1/catalog/series/kaanch-ka-mahal/pricing",
                   headers=FIN_H, json={"coin_price": 4000,
                                        "confirm": "kaanch-ka-mahal"}).status_code == 400
    assert a.patch("/admin/v1/catalog/series/kaanch-ka-mahal/pricing",
                   headers=FIN_H, json={"free_episodes": 500,
                                        "confirm": "kaanch-ka-mahal"}).status_code == 400
    assert a.patch("/admin/v1/catalog/series/kaanch-ka-mahal/pricing",
                   headers=FIN_H, json={"confirm": "kaanch-ka-mahal"}).status_code == 400
    assert a.patch("/admin/v1/catalog/series/nope/pricing", headers=FIN_H,
                   json={"coin_price": 40, "confirm": "nope"}).status_code == 404
    # episodes: bounds + unknown series
    assert a.patch("/admin/v1/catalog/series/nope/episodes/1", headers=ADMIN_H,
                   json={"title": "x"}).status_code == 404
    assert a.patch("/admin/v1/catalog/series/kaanch-ka-mahal/episodes/1",
                   headers=ADMIN_H, json={"title": ""}).status_code == 400
    # rights unknown series
    assert a.patch("/admin/v1/catalog/series/nope/rights", headers=ADMIN_H,
                   json={"owner": "X"}).status_code == 404
    # create: bad count + missing title
    assert a.post("/admin/v1/catalog/series", headers=ADMIN_H,
                  json={"slug": "ok-slug", "title": "T",
                        "episode_count": 0}).status_code == 400
    assert a.post("/admin/v1/catalog/series", headers=ADMIN_H,
                  json={"slug": "ok-slug", "title": "",
                        "episode_count": 3}).status_code == 400
    # experiments: bad key/status/variant
    assert a.put("/admin/v1/experiments/BAD KEY", headers=ADMIN_H,
                 json={"status": "draft"}).status_code == 400
    assert a.put("/admin/v1/experiments/ok-exp", headers=ADMIN_H,
                 json={"status": "sideways"}).status_code == 400
    assert a.put("/admin/v1/experiments/ok-exp", headers=ADMIN_H,
                 json={"status": "running", "variants": []}).status_code == 400
    assert a.put("/admin/v1/experiments/ok-exp", headers=ADMIN_H,
                 json={"status": "running",
                       "variants": [{"name": "", "pct": 10}]}).status_code == 400
    # flags: pct bounds
    assert a.patch("/admin/v1/config/flags/rewards.referral_enabled",
                   headers=ADMIN_H,
                   json={"enabled": True, "pct": 140}).status_code == 400
    # analytics needs a viewer role but works for RO
    assert a.get("/admin/v1/analytics",
                 headers={"X-Actor-Id": "view", "X-Role": "ro"}).status_code == 200
    # rupee rate falls back on junk
    shared.kv_set("config:coin.rupee_rate", "banana")
    assert a.get("/admin/v1/config/policy",
                 headers=ADMIN_H).json()["coin_rupee_rate"] == 0.15
    # devices empty for unknown user; ui ping ignores blank view
    assert a.get("/admin/v1/users/ghost/devices",
                 headers=ADMIN_H).json()["devices"] == []
    assert a.post("/admin/v1/metrics/ui", headers=ADMIN_H,
                  json={}).json() == {"ok": True}


def test_audit_annotation_beside_the_chain(shared):
    """#070: a note explains a row; the hash chain never changes."""
    a = _admin()
    a.post("/admin/v1/wallet/adjust", headers=ADMIN_H,
           json={"user_id": "n-u", "coins": 10, "reason_code": "goodwill"})
    rows = a.get("/admin/v1/audit", headers=ADMIN_H).json()
    row_id = rows["rows"][0]["id"]
    hash_before = rows["rows"][0]["hash"]
    r = a.patch(f"/admin/v1/audit/{row_id}/note", headers=ADMIN_H,
                json={"note": "no-op — double-fire era"})
    assert r.status_code == 200
    out = a.get("/admin/v1/audit", headers=ADMIN_H).json()
    noted = next(x for x in out["rows"] if x["id"] == row_id)
    assert noted["note"]["note"] == "no-op — double-fire era"
    assert noted["note"]["by"] == "root@katha.dev"
    assert noted["hash"] == hash_before and out["chain_ok"] is True
    # the annotation act is itself audited
    assert any(x["action"] == "audit.note" for x in out["rows"])
    # guards: bad ids and empty notes
    assert a.patch("/admin/v1/audit/999999/note", headers=ADMIN_H,
                   json={"note": "x"}).status_code == 404
    assert a.patch(f"/admin/v1/audit/{row_id}/note", headers=ADMIN_H,
                   json={"note": ""}).status_code == 400
    # admin-only
    assert a.patch(f"/admin/v1/audit/{row_id}/note",
                   headers={"X-Actor-Id": "s", "X-Role": "support"},
                   json={"note": "x"}).status_code == 403


def test_ip_allowlist(shared, monkeypatch):
    """#084: with an allowlist set, unknown callers get 403 everywhere."""
    a = _admin()
    monkeypatch.setenv("KATHA_ADMIN_IP_ALLOWLIST", "10.0.0.0/8, 192.168.1.5")
    r = a.get("/admin/v1/config/policy", headers=ADMIN_H)
    assert r.status_code == 403 and "not allowed" in r.json()["detail"]
    # exact-host entries admit the TestClient ("testclient")
    monkeypatch.setenv("KATHA_ADMIN_IP_ALLOWLIST", "10.0.0.0/8, testclient")
    assert a.get("/admin/v1/config/policy", headers=ADMIN_H).status_code == 200
    # unset → open (dev default)
    monkeypatch.delenv("KATHA_ADMIN_IP_ALLOWLIST")
    assert a.get("/admin/v1/config/policy", headers=ADMIN_H).status_code == 200


def test_malformed_kv_is_tolerated_everywhere(shared):
    """Operators fat-finger config; every KV consumer shrugs instead of 500s."""
    for key in ("rights:kaanch-ka-mahal", "rating:kaanch-ka-mahal",
                "attnack:approvals", "auditnote:1", "price:kaanch-ka-mahal",
                "pack:coins_starter_in", "exp:broken", "flag:rewards.checkin_enabled",
                "series:broken-draft"):
        shared.kv_set(key, "{not json")
    a = _admin()
    core = _core()
    # catalog list + detail + core catalog all still serve
    assert a.get("/admin/v1/catalog/series", headers=ADMIN_H).status_code == 200
    det = a.get("/admin/v1/catalog/series/kaanch-ka-mahal", headers=ADMIN_H)
    assert det.status_code == 200
    assert det.json()["rights"]["owner"] == "Katha Originals"
    assert core.get("/v1/series/kaanch-ka-mahal").status_code == 200
    assert core.get("/v1/series").status_code == 200
    # packs merge, flags, experiments, config all survive the garbage
    assert a.get("/admin/v1/config/packs", headers=FIN_H).status_code == 200
    assert a.get("/admin/v1/config/flags", headers=ADMIN_H).status_code == 200
    assert a.get("/admin/v1/experiments", headers=ADMIN_H).json()["experiments"] == []
    cfg = core.get("/v1/config", headers={"Authorization": "Bearer kv-u"})
    assert cfg.status_code == 200 and cfg.json()["experiments"] == {}
    # attention + audit shrug at broken ack/note records
    a.post("/admin/v1/wallet/adjust", headers=ADMIN_H,
           json={"user_id": "kv-u", "coins": 600, "reason_code": "goodwill"})
    items = a.get("/admin/v1/attention", headers=ADMIN_H).json()["items"]
    assert any(i["id"] == "approvals" and "ack" not in i for i in items)
    assert a.get("/admin/v1/audit", headers=ADMIN_H).status_code == 200
    # a rating override that IS valid JSON reaches the summaries (#041)
    shared.kv_set("rating:kaanch-ka-mahal", json.dumps({"value": "A"}))
    summaries = core.get("/v1/series").json()
    km = next(s for s in summaries if s["slug"] == "kaanch-ka-mahal")
    assert km["content_rating"] == "A"


def test_risk_flags_and_chain_tamper_detection(shared):
    pl = PersistentLedger(shared.db)
    # repeat refunds
    pl.credit("risk-u", TxType.PURCHASE, coins=600, reference_type="iap",
              reference_id="s", idempotency_key="rk1", created_at=T0)
    pl.refund_clawback("risk-u", coins=100, reference_type="gateway_refund",
                       reference_id="r1", idempotency_key="rk2", created_at=T0)
    pl.refund_clawback("risk-u", coins=100, reference_type="gateway_refund",
                       reference_id="r2", idempotency_key="rk3", created_at=T0)
    # negative balance via a clawback beyond the wallet
    pl.credit("neg-u", TxType.PURCHASE, coins=50, reference_type="iap",
              reference_id="s", idempotency_key="rk4", created_at=T0)
    pl.refund_clawback("neg-u", coins=200, reference_type="gateway_refund",
                       reference_id="r3", idempotency_key="rk5", created_at=T0)
    # erased profile
    shared.upsert_profile("gone-u", phone="+919", kind="phone", language="hi",
                          created_at=T0)
    shared.erase_user("gone-u", T0)
    by_id = {u["user_id"]: u for u in shared.search_users(limit=50)["users"]}
    assert by_id["risk-u"]["flags"] == ["repeat refunds"]
    assert "negative balance" in by_id["neg-u"]["flags"]
    assert "erased (DPDP)" in by_id["gone-u"]["flags"]

    # tampering with any persisted audit row breaks the verified chain
    shared.audit_append(ts=T0, actor_id="riya", actor_role="admin",
                        action="t.a", target="x", detail="d=1")
    shared.audit_append(ts=T0, actor_id="riya", actor_role="admin",
                        action="t.b", target="y", detail="d=2")
    assert shared.audit_list()["chain_ok"] is True
    import sqlite3
    raw = sqlite3.connect(str(shared.db.url).split("///")[1])
    raw.execute("UPDATE audit_log SET detail='d=999' WHERE action='t.a'")
    raw.commit()
    assert shared.audit_list()["chain_ok"] is False


def test_devices_update_and_analytics_branches(shared):
    # same UA twice → the row updates, no duplicate
    shared.device_touch("dev-u", ua="KathaApp/1.0", ip="1.1.1.1", ts=T0)
    shared.device_touch("dev-u", ua="KathaApp/1.0", ip="2.2.2.2",
                        ts="2026-09-01T01:00:00+00:00")
    devs = shared.devices("dev-u")
    assert len(devs) == 1 and devs[0]["ip"] == "2.2.2.2"

    # checkin events, unlock spends, and out-of-window rows hit their branches
    shared.event_append(ts=T0, user_id="an-u", name="checkin", value=5)
    shared.event_append(ts="2020-01-01T00:00:00+00:00", user_id="old-u",
                        name="purchase")                       # before the span
    pl = PersistentLedger(shared.db)
    pl.credit("an-u", TxType.PURCHASE, coins=90, reference_type="iap",
              reference_id="s", idempotency_key="ab1", created_at=T0)
    pl.unlock("an-u", episode_ids=["kaanch-ka-mahal:e11"], price_per_episode=30,
              reference_type="episode", reference_id="kaanch-ka-mahal:e11",
              idempotency_key="ab2", created_at=T0)
    a = shared.analytics(now=T0, days=3)
    today = a["daily"][-1]
    assert today["checkins"] == 1 and today["coins_spent"] == 30
    # the 2020 event is outside every daily bucket but never crashes the rollup
    assert len(a["daily"]) == 3


def test_health_down_paths_and_resolve_breach(shared, monkeypatch):
    import urllib.request as _ur
    def refuse(*a, **kw):
        raise OSError("connection refused")
    monkeypatch.setattr(_ur, "urlopen", refuse)
    a = _admin()
    h = a.get("/admin/v1/health/full").json()
    assert h["checks"]["core_api"] == "down" and h["status"] == "down"
    # a database probe failure reports down too
    real_kv = shared.kv_get
    def flaky(key):
        if key == "health:probe":
            raise RuntimeError("db gone")
        return real_kv(key)
    monkeypatch.setattr(shared, "kv_get", flaky)
    assert a.get("/admin/v1/health/full").json()["checks"]["database"] == "down"
    monkeypatch.setattr(shared, "kv_get", real_kv)
    # unhealthy services surface on the attention rail
    items = a.get("/admin/v1/attention", headers=ADMIN_H).json()["items"]
    assert any(i["id"] == "health" for i in items)

    # an acknowledged-but-stale grievance breaches the 15-day resolution SLA
    shared.grievance_create(gid="G-OLD15", user_id="u", contact="a@b",
                            channel="app", subject="slow", body="",
                            created_at="2026-08-10T00:00:00+00:00")
    shared.grievance_update("G-OLD15", status="ack", ack_at="2026-08-10T01:00:00+00:00")
    items = a.get("/admin/v1/attention", headers=ADMIN_H).json()["items"]
    assert any("15-day resolution" in i["title"] for i in items)
    # unknown grievance ids 404 on ack
    assert a.post("/admin/v1/grievances/G-NOPE/ack",
                  headers=ADMIN_H).status_code == 404


def test_last_analytics_and_overrides_lines(shared):
    # future-dated event + out-of-span ledger row never crash the rollup
    shared.event_append(ts="2030-01-01T00:00:00+00:00", user_id="f-u",
                        name="purchase")
    pl = PersistentLedger(shared.db)
    pl.credit("old-u", TxType.PURCHASE, coins=10, reference_type="iap",
              reference_id="s", idempotency_key="ol1",
              created_at="2020-01-01T00:00:00+00:00")
    a = shared.analytics(now=T0, days=2)
    assert len(a["daily"]) == 2
    # the 2020 purchase still counts toward cumulative outstanding
    assert a["outstanding_trend"][0] >= 10

    # a second writer's entitlement folds in on refresh (persistent_ledger #87)
    pl.unlock("old-u", episode_ids=["kaanch-ka-mahal:e11"], price_per_episode=5,
              reference_type="episode", reference_id="kaanch-ka-mahal:e11",
              idempotency_key="ol2", created_at=T0)
    pl2 = PersistentLedger(shared.db)
    pl2.refresh()
    assert pl2.is_entitled("old-u", "kaanch-ka-mahal:e11")

    # episode-title override with a non-numeric suffix is skipped, not fatal
    shared.kv_set("ep:kaanch-ka-mahal:abc", json.dumps({"title": "x"}))
    core = _core()
    assert core.get("/v1/series/kaanch-ka-mahal").status_code == 200
    # a KV draft that shadows a seed slug never duplicates the catalog
    shared.kv_set("series:kaanch-ka-mahal", json.dumps(
        {"title": "Shadow", "episode_count": 2}))
    slugs = [s["slug"] for s in core.get("/v1/series").json()]
    assert slugs.count("kaanch-ka-mahal") == 1

    # a stopped experiment assigns nobody
    shared.kv_set("exp:paused", json.dumps(
        {"variants": [{"name": "a", "pct": 100}], "status": "stopped"}))
    cfg = core.get("/v1/config", headers={"Authorization": "Bearer x-u"}).json()
    assert "paused" not in cfg["experiments"]

    # user ledger drill-down through the shared store
    a2 = _admin()
    led = a2.get("/admin/v1/users/old-u/ledger", headers=ADMIN_H).json()
    assert led["wallet"]["total"] == 5 and len(led["transactions"]) == 2

    # attention skips resolved grievances
    shared.grievance_create(gid="G-DONE", user_id="u", contact="a@b",
                            channel="app", subject="done", body="",
                            created_at="2026-08-01T00:00:00+00:00")
    shared.grievance_update("G-DONE", status="resolved", resolved_at=T0)
    items = a2.get("/admin/v1/attention", headers=ADMIN_H).json()["items"]
    assert not any(i["id"] == "G-DONE" for i in items)


def test_config_serves_rate_and_checkin(shared):
    core = _core()
    cfg = core.get("/v1/config").json()
    assert cfg["coin_rupee_rate"] == 0.15 and cfg["checkin_coins"] == 5
    shared.kv_set("config:coin.rupee_rate", "0.2")
    assert core.get("/v1/config").json()["coin_rupee_rate"] == 0.2
    shared.kv_set("config:coin.rupee_rate", "junk")
    assert core.get("/v1/config").json()["coin_rupee_rate"] == 0.15


def test_web_order_creates_invoice_and_email_once(shared):
    core = _core()
    r = core.post("/v1/web/orders", headers={"Authorization": "Bearer inv-u"},
                  json={"sku": "coins_web_popular_in", "email": "meera@example.com"})
    assert r.status_code == 200
    # replay: idempotent credit AND no duplicate invoice/email
    core.post("/v1/web/orders", headers={"Authorization": "Bearer inv-u"},
              json={"sku": "coins_web_popular_in", "email": "meera@example.com"})
    invs = core.get("/v1/me/invoices",
                    headers={"Authorization": "Bearer inv-u"}).json()["invoices"]
    assert len(invs) == 1
    inv = invs[0]
    # ₹199 GST-inclusive @18%: taxable 16864 + gst 3036 = 19900
    assert inv["total_minor"] == 19900
    assert inv["taxable_minor"] == 16864 and inv["gst_minor"] == 3036
    assert inv["id"].startswith("KATHA-INV-2627-")
    assert inv["coins"] == 1300 and inv["bonus_coins"] == 130
    # the email sits in the outbox (dev transport), queued with the number
    mails = shared.outbox_list(kind="email")
    assert mails[0]["recipient"] == "meera@example.com"
    assert inv["id"] in mails[0]["subject"]
    assert "GST @ 18%" in mails[0]["body"] and mails[0]["status"] == "queued"
    # a second order (different sku) gets the next sequential number
    core.post("/v1/web/orders", headers={"Authorization": "Bearer inv-u"},
              json={"sku": "coins_starter_in"})
    invs = core.get("/v1/me/invoices",
                    headers={"Authorization": "Bearer inv-u"}).json()["invoices"]
    nums = sorted(i["id"] for i in invs)
    assert nums[0].endswith("000001") and nums[1].endswith("000002")


def test_push_register_and_drop_notification(shared):
    core = _core()
    r = core.post("/v1/push/register", headers={"Authorization": "Bearer push-u"},
                  json={"token": "devtok-abc123", "platform": "ios"})
    assert r.json() == {"registered": True}
    core.post("/v1/push/register", headers={"Authorization": "Bearer push-u"},
              json={"token": "devtok-abc123"})          # idempotent re-register
    core.post("/v1/push/register", headers={"Authorization": "Bearer push-u2"},
              json={"token": "devtok-def456"})
    assert core.post("/v1/push/register",
                     headers={"Authorization": "Bearer push-u"},
                     json={"token": ""}).status_code == 400
    assert len(shared.push_tokens()) == 2

    a = _admin()
    r = a.post("/admin/v1/catalog/series/kaanch-ka-mahal/notify-drop",
               headers=ADMIN_H, json={"episode": 12})
    assert r.status_code == 200 and r.json()["devices"] == 2
    pushes = shared.outbox_list(kind="push")
    assert len(pushes) == 2 and pushes[0]["subject"] == "Kaanch Ka Mahal"
    assert '"episode": 12' in pushes[0]["body"].replace("'", '"') or \
           '"episode": 12' in pushes[0]["body"]
    assert pushes[0]["status"] == "queued"       # no APNs creds in dev
    # guards
    assert a.post("/admin/v1/catalog/series/nope/notify-drop", headers=ADMIN_H,
                  json={"episode": 1}).status_code == 404
    assert a.post("/admin/v1/catalog/series/kaanch-ka-mahal/notify-drop",
                  headers=ADMIN_H, json={}).status_code == 400
    # outbox endpoint serves it all with transport truth
    ob = a.get("/admin/v1/outbox", headers=ADMIN_H).json()
    assert ob["transports"] == {"email": False, "push": False}
    assert any(x["kind"] == "push" for x in ob["rows"])
    only_push = a.get("/admin/v1/outbox?kind=push", headers=ADMIN_H).json()["rows"]
    assert all(x["kind"] == "push" for x in only_push)


def test_grievance_lifecycle_emails_complainant(shared):
    core = _core()
    gid = core.post("/v1/grievance", headers={"Authorization": "Bearer g-u"},
                    json={"contact": "user@example.com",
                          "subject": "double charge"}).json()["id"]
    a = _admin()
    a.post(f"/admin/v1/grievances/{gid}/ack", headers=ADMIN_H)
    a.post(f"/admin/v1/grievances/{gid}/resolve", headers=ADMIN_H,
           json={"note": "duplicate refunded"})
    mails = [m for m in shared.outbox_list(kind="email")
             if m["recipient"] == "user@example.com"]
    assert len(mails) == 2
    assert "resolved" in mails[0]["subject"] and "acknowledged" in mails[1]["subject"]
    assert "duplicate refunded" in mails[0]["body"]
    # a phone-only contact gets no email, and nothing crashes
    gid2 = core.post("/v1/grievance", headers={"Authorization": "Bearer g-u"},
                     json={"contact": "+919876543210", "subject": "s"}).json()["id"]
    a.post(f"/admin/v1/grievances/{gid2}/ack", headers=ADMIN_H)
    assert not any(m["recipient"] == "+919876543210"
                   for m in shared.outbox_list(kind="email"))


def test_push_tokens_per_user_filter(shared):
    shared.push_register("pu-1", token="t1", platform="ios", now=T0)
    shared.push_register("pu-2", token="t2", platform="ios", now=T0)
    assert [t["token"] for t in shared.push_tokens("pu-1")] == ["t1"]


def test_guest_merge_on_login(shared):
    core = _core()
    # a guest earns coins and unlocks an episode
    g = core.post("/v1/auth/guest").json()
    gtok, gid = g["access_token"], g["user"]["user_id"]
    core.post("/v1/iap/verify", headers={"Authorization": f"Bearer {gtok}"},
              json={"sku": "coins_starter_in", "jws": "merge-sig"})
    core.post("/v1/series/kaanch-ka-mahal/episodes/11/unlock",
              headers={"Authorization": f"Bearer {gtok}"},
              json={"idempotency_key": "mg-1"})
    core.put("/v1/progress", headers={"Authorization": f"Bearer {gtok}"},
             json={"items": [{"slug": "kaanch-ka-mahal", "number": 11,
                              "position_ms": 30000, "duration_ms": 120000}]})
    # OTP login WITH the guest bearer → everything follows the member
    m = core.post("/v1/auth/otp/verify",
                  headers={"Authorization": f"Bearer {gtok}"},
                  json={"phone": "+911112223334", "code": "1234"}).json()
    mtok = m["access_token"]
    w = core.get("/v1/wallet", headers={"Authorization": f"Bearer {mtok}"}).json()
    assert w["balance_bought"] == 570 and w["total"] == 570
    # entitlement moved: E11 plays without paying again
    p = core.post("/v1/series/kaanch-ka-mahal/episodes/11/playback",
                  headers={"Authorization": f"Bearer {mtok}"}).json()
    assert p["locked"] is False
    # continue-watching moved too
    cont = core.get("/v1/me/continue",
                    headers={"Authorization": f"Bearer {mtok}"}).json()
    assert any(i["episode_id"] == "kaanch-ka-mahal:e11" for i in cont["items"])
    # the guest wallet is zeroed and the merge is idempotent on re-login
    gw = core.get("/v1/wallet", headers={"Authorization": f"Bearer {gtok}"}).json()
    assert gw["total"] == 0
    core.post("/v1/auth/otp/verify", headers={"Authorization": f"Bearer {gtok}"},
              json={"phone": "+911112223334", "code": "1234"})
    w2 = core.get("/v1/wallet", headers={"Authorization": f"Bearer {mtok}"}).json()
    assert w2["total"] == 570
    # a member-to-member login never merges
    assert core_store.merge_guest("usr_somebody", "usr_other") is None


def test_cover_urls_are_versioned_and_bust_on_regeneration(shared, tmp_path, monkeypatch):
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(tmp_path))
    import app.overrides as ov
    (tmp_path / "kaanch-ka-mahal").mkdir()
    f = tmp_path / "kaanch-ka-mahal" / "cover_9x16.jpg"
    f.write_bytes(b"art-1")
    import os
    os.utime(f, (1000, 1000))
    ov._COVER_V.clear()
    core = _core()
    url1 = core.get("/v1/series/kaanch-ka-mahal").json()["cover_url"]
    assert "?v=3e8" in url1                      # hex(1000)
    os.utime(f, (2000, 2000))                    # "regenerated" art
    ov._COVER_V.clear()                          # (60s cache in prod)
    url2 = core.get("/v1/series/kaanch-ka-mahal").json()["cover_url"]
    assert "?v=7d0" in url2 and url1 != url2
    # a draft series gets real cover URLs too
    a = _admin()
    a.post("/admin/v1/catalog/series", headers=ADMIN_H,
           json={"slug": "art-draft", "title": "Art Draft", "episode_count": 2})
    a.post("/admin/v1/catalog/series/art-draft/status", headers=ADMIN_H,
           json={"status": "live"})
    d = core.get("/v1/series/art-draft").json()
    assert "/media/art-draft/cover_9x16.jpg?v=" in d["cover_url"]
    ov._COVER_V.clear()


def test_erasure_scrubs_devices_and_push_tokens(shared):
    shared.upsert_profile("scrub-u", phone="+919", kind="phone", language="hi",
                          created_at=T0)
    shared.push_register("scrub-u", token="tok-scrub", platform="ios", now=T0)
    shared.device_touch("scrub-u", ua="KathaApp/1.0", ip="1.1.1.1", ts=T0)
    assert shared.erase_user("scrub-u", T0) is True
    assert shared.push_tokens("scrub-u") == []
    assert shared.devices("scrub-u") == []


def test_invoice_register_totals(shared):
    core = _core()
    for u, sku in (("reg-a", "coins_web_popular_in"), ("reg-b", "coins_starter_in")):
        core.post("/v1/web/orders", headers={"Authorization": f"Bearer {u}"},
                  json={"sku": sku, "email": f"{u}@x.dev"})
    a = _admin()
    assert a.get("/admin/v1/invoices",
                 headers={"X-Actor-Id": "s", "X-Role": "support"}).status_code == 403
    reg = a.get("/admin/v1/invoices", headers=FIN_H).json()
    assert reg["totals"]["count"] == 2
    assert reg["totals"]["gross_minor"] == 19900 + 9900
    assert reg["totals"]["gst_minor"] == 3036 + 1510


def test_guest_merge_carries_bonus_coins(shared):
    core = _core()
    g = core.post("/v1/auth/guest").json()
    gtok = g["access_token"]
    core.post("/v1/web/orders", headers={"Authorization": f"Bearer {gtok}"},
              json={"sku": "coins_web_popular_in"})       # 1300 bought + 130 bonus
    m = core.post("/v1/auth/otp/verify",
                  headers={"Authorization": f"Bearer {gtok}"},
                  json={"phone": "+911112224445", "code": "1234"}).json()
    w = core.get("/v1/wallet",
                 headers={"Authorization": f"Bearer {m['access_token']}"}).json()
    assert w["balance_bought"] == 1300 and w["balance_bonus"] == 130


# ---- OTP abuse guard ---------------------------------------------------------

def _otp_reset():
    from app.routers import auth as auth_router
    auth_router._otp_hits.clear()


def test_otp_request_rate_limited_per_phone(shared):
    _otp_reset()
    shared.kv_set("config:otp.limits",
                  json.dumps({"phone": 2, "verify": 3, "ip": 100, "window_s": 600}))
    for _ in range(2):
        assert core.post("/v1/auth/otp/request",
                         json={"phone": "+919000000001"}).status_code == 200
    r = core.post("/v1/auth/otp/request", json={"phone": "+919000000001"})
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1
    # A different phone from the same IP is still fine (ip cap is 100).
    assert core.post("/v1/auth/otp/request",
                     json={"phone": "+919000000002"}).status_code == 200


def test_otp_verify_rate_limited_and_ip_cap(shared):
    _otp_reset()
    shared.kv_set("config:otp.limits",
                  json.dumps({"phone": 100, "verify": 2, "ip": 3, "window_s": 600}))
    ok = core.post("/v1/auth/otp/verify",
                   json={"phone": "+919000000003", "code": "1234"})
    assert ok.status_code == 200
    core.post("/v1/auth/otp/verify", json={"phone": "+919000000003", "code": "1234"})
    r = core.post("/v1/auth/otp/verify",
                  json={"phone": "+919000000003", "code": "1234"})
    assert r.status_code == 429                      # verify cap (2) tripped
    # The IP window (3) is also exhausted now — a fresh phone gets 429 too.
    r2 = core.post("/v1/auth/otp/verify",
                   json={"phone": "+919000000004", "code": "1234"})
    assert r2.status_code == 429


def test_otp_window_prunes_and_malformed_kv_falls_back(shared):
    import time as _time
    from app.routers import auth as auth_router
    _otp_reset()
    shared.kv_set("config:otp.limits", json.dumps({"phone": 1, "ip": 100}))
    # A full window of ANCIENT hits must not count against the caller.
    auth_router._otp_hits["phone:p:+919000000005"] = [_time.monotonic() - 9999.0]
    assert core.post("/v1/auth/otp/request",
                     json={"phone": "+919000000005"}).status_code == 200
    # Garbage KV (both non-JSON and non-dict JSON) → generous defaults apply.
    for garbage in ("not json", "[1,2]"):
        _otp_reset()
        shared.kv_set("config:otp.limits", garbage)
        assert core.post("/v1/auth/otp/request",
                         json={"phone": "+919000000006"}).status_code == 200


# ---- outbox retry + invoice CSV ---------------------------------------------

def test_outbox_retry_email_lifecycle(shared, monkeypatch):
    rid = shared.outbox_append(kind="email", recipient="meera@example.com",
                               subject="Your invoice", body="<b>hi</b>", now=T0)
    shared.outbox_mark(rid, "failed", detail="boom")
    pid = shared.outbox_append(kind="push", recipient="ccecaee4…",
                               subject="drop", body="{}", now=T0)

    # No SMTP configured → an honest 409, nothing pretends to send.
    r = admin.post(f"/admin/v1/outbox/{rid}/retry", headers=SUPPORT)
    assert r.status_code == 409 and "KATHA_SMTP_URL" in r.json()["detail"]

    monkeypatch.setenv("KATHA_SMTP_URL", "smtp://u:p@mail.test:587")
    from katha_infra import comms
    sent_to = []
    monkeypatch.setattr(comms, "_smtp_deliver",
                        lambda to, subject, body: sent_to.append(to))
    r = admin.post(f"/admin/v1/outbox/{rid}/retry", headers=SUPPORT)
    assert r.status_code == 200 and r.json()["status"] == "sent"
    assert sent_to == ["meera@example.com"]
    assert shared.outbox_get(rid)["status"] == "sent"
    assert any(row["action"] == "outbox.retry"
               for row in shared.audit_list(limit=10)["rows"])

    assert admin.post(f"/admin/v1/outbox/{rid}/retry",
                      headers=SUPPORT).status_code == 409   # already sent
    assert admin.post(f"/admin/v1/outbox/{pid}/retry",
                      headers=SUPPORT).status_code == 409   # push rows can't
    assert admin.post("/admin/v1/outbox/99999/retry",
                      headers=SUPPORT).status_code == 404
    assert admin.post(f"/admin/v1/outbox/{rid}/retry",
                      headers=QC).status_code == 403


def test_outbox_retry_records_a_fresh_failure(shared, monkeypatch):
    rid = shared.outbox_append(kind="email", recipient="x@y.z",
                               subject="s", body="b", now=T0)
    monkeypatch.setenv("KATHA_SMTP_URL", "smtp://u:p@mail.test:587")
    from katha_infra import comms
    def _blow(to, subject, body):
        raise RuntimeError("mailbox on fire")
    monkeypatch.setattr(comms, "_smtp_deliver", _blow)
    r = admin.post(f"/admin/v1/outbox/{rid}/retry", headers=SUPPORT)
    assert r.status_code == 200 and r.json()["status"] == "failed"
    assert "mailbox on fire" in shared.outbox_get(rid)["detail"]


def test_invoice_csv_export(shared):
    shared.invoice_create(
        id="KATHA-INV-2627-000007", user_id="u_csv", order_ref="web:u_csv:sku",
        sku="coins_web_popular_in", coins=1300, bonus_coins=130,
        total_minor=19900, taxable_minor=16864, gst_minor=3036,
        gst_rate_pct=18, seller_gstin="27ABCDE1234F1Z5", created_at=T0)
    r = admin.get("/admin/v1/invoices.csv", headers=FINANCE)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    lines = r.text.strip().splitlines()
    assert lines[0].startswith("invoice_no,date,buyer")
    assert "KATHA-INV-2627-000007" in r.text and "16864,3036,19900" in r.text
    assert admin.get("/admin/v1/invoices.csv", headers=SUPPORT).status_code == 403


# ---- home personalization ----------------------------------------------------

def test_home_trending_ranks_by_recent_play_starts(shared):
    from katha_domain.timeutil import now_iso
    now = now_iso()
    for _ in range(3):
        shared.event_append(ts=now, user_id="v1", name="play_start",
                            ref="ceo-sahab:e1")
    shared.event_append(ts=now, user_id="v2", name="play_start",
                        ref="kaanch-ka-mahal:e1")
    # Ancient traffic must not count toward the 7-day window.
    for _ in range(9):
        shared.event_append(ts="2020-01-01T00:00:00+00:00", user_id="v3",
                            name="play_start", ref="prema-pariksha:e1")
    rows = core.get("/v1/home").json()["rows"]
    trending = rows[0]
    assert trending["series"][0]["slug"] == "ceo-sahab"
    assert trending["series"][1]["slug"] == "kaanch-ka-mahal"
    assert trending["series"][2]["slug"] != "prema-pariksha"


def test_home_because_you_watched_rail(shared):
    tok = core.post("/v1/auth/guest").json()["access_token"]
    hdr = {"Authorization": f"Bearer {tok}"}
    core.put("/v1/progress", headers=hdr, json={"items": [
        {"slug": "kaanch-ka-mahal", "number": 1, "position_ms": 30000,
         "duration_ms": 90000},
        {"slug": "kaanch-ka-mahal", "number": 2, "position_ms": 1000,
         "duration_ms": 90000},
    ]})
    rows = core.get("/v1/home", headers=hdr).json()["rows"]
    titles = [r["title"] for r in rows]
    byw = next(r for r in rows if r["title"].startswith("Because you watched"))
    assert "Kaanch Ka Mahal" in byw["title"]
    assert titles[-1] == "New this week"                  # rail order kept
    slugs = [s["slug"] for s in byw["series"]]
    assert "kaanch-ka-mahal" not in slugs and len(slugs) >= 1
    # Anonymous callers never get the personal rail.
    anon = core.get("/v1/home").json()["rows"]
    assert not any(r["title"].startswith("Because") for r in anon)


def test_recs_edge_paths(shared):
    from app import recs
    from app.store import ProgressItem, UserEngagement
    from katha_domain import catalog as dom_catalog
    served = [s for s in dom_catalog.summaries()]
    # Seed series that vanished from the catalog → no rail.
    core_store.engagement["u_ghost"] = UserEngagement(progress={
        "ghost:e1": ProgressItem(slug="ghost", number=1, episode_id="ghost:e1")})
    assert recs.because_you_watched("u_ghost", served) is None
    # Nothing else to score against → no rail.
    core_store.engagement["u_solo"] = UserEngagement(progress={
        served[0].slug + ":e1": ProgressItem(
            slug=served[0].slug, number=1, episode_id=served[0].slug + ":e1")})
    assert recs.because_you_watched("u_solo", [served[0]]) is None
    # A candidate with no catalog detail (panel draft) still scores by genre.
    from katha_domain.schemas import SeriesSummary
    hand = SeriesSummary(slug="hand-made", title="Hand Made",
                         genres=list(served[0].genres),
                         episode_count=12, primary_language="hi")
    got = recs.because_you_watched("u_solo", [served[0], hand])
    assert got is not None and got[1][0].slug == "hand-made"


def test_guest_merge_over_persistent_ledger(shared):
    """Regression from the device suite: merge crashed with AttributeError on
    PersistentLedger (missing .entitlements) — every other test swaps in the
    pure in-memory ledger, so run the whole login-merge over the real one."""
    core_store.ledger = PersistentLedger(shared.db)
    try:
        g = core.post("/v1/auth/guest").json()
        gtok, gid = g["access_token"], g["user"]["user_id"]
        core.post("/v1/iap/verify",
                  json={"jws": "dev-jws-merge-pl", "sku": "coins_starter_in"},
                  headers={"Authorization": f"Bearer {gtok}"})
        m = core.post("/v1/auth/otp/verify",
                      headers={"Authorization": f"Bearer {gtok}"},
                      json={"phone": "+915550001111", "code": "1234"})
        assert m.status_code == 200
        w = core.get("/v1/wallet",
                     headers={"Authorization": f"Bearer {m.json()['access_token']}"}).json()
        assert w["total"] > 0                      # coins survived the merge
        assert core_store.ledger.balance(gid).total == 0   # guest zeroed
    finally:
        core_store.ledger = Ledger()

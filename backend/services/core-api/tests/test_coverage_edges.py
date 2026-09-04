"""The failure directions: no-persistence guards, malformed-config tolerance,
runner shutdown, guest auth. Every branch here is one a 2am incident would
walk — they deserve the same green as the happy paths."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

import admin_app.main as admin_main
from admin_app import oidc
from app.main import app as core_app
from app.store import store as core_store
from katha_domain.flags import effective_flags

core = TestClient(core_app)
admin = TestClient(admin_main.app)
ADMIN = {"X-Actor-Id": "riya", "X-Role": "admin"}
FINANCE = {"X-Actor-Id": "farah", "X-Role": "finance"}


def test_everything_stateful_refuses_cleanly_without_persistence():
    """SHARED is None in this module: every KV/DB-backed mutation must say so
    with 503 instead of pretending, and reads fall back to honest emptiness."""
    assert admin_main.SHARED is None
    calls_503 = [
        ("POST", "/admin/v1/attention/x/ack", {}),
        ("GET", "/admin/v1/analytics", None),
        ("PATCH", "/admin/v1/catalog/series/kaanch-ka-mahal/pricing",
         {"coin_price": 40, "confirm": "kaanch-ka-mahal"}),
        ("PATCH", "/admin/v1/catalog/series/kaanch-ka-mahal/episodes/1",
         {"title": "x"}),
        ("PATCH", "/admin/v1/catalog/series/kaanch-ka-mahal/rights",
         {"owner": "x"}),
        ("POST", "/admin/v1/catalog/series",
         {"slug": "np-series", "title": "t", "episode_count": 2}),
        ("PUT", "/admin/v1/experiments/np-exp", {"status": "draft"}),
        ("POST", "/admin/v1/users/u1/signout-devices", None),
        ("PATCH", "/admin/v1/audit/1/note", {"note": "x"}),
        ("PATCH", "/admin/v1/config/packs/coins_starter_in",
         {"coins": 700, "confirm": "coins_starter_in"}),
        ("PATCH", "/admin/v1/config/values/app.min_version", {"value": "1.1.0"}),
        ("POST", "/admin/v1/users/u1/erase", None),
        ("GET", "/admin/v1/users/u1/export", None),
        ("POST", "/admin/v1/wallet/refund", {"user_id": "u1", "tx_id": "t"}),
    ]
    for method, path, body in calls_503:
        r = admin.request(method, path, headers=ADMIN,
                          json=body if body is not None else None)
        assert r.status_code == 503, f"{method} {path} -> {r.status_code}"
    # honest empty fallbacks, not errors
    assert admin.get("/admin/v1/users/u1/entitlements",
                     headers=ADMIN).json() == {"user_id": "u1", "entitlements": []}
    assert admin.get("/admin/v1/experiments",
                     headers=ADMIN).json() == {"experiments": []}
    assert admin.get("/admin/v1/users/u1/devices",
                     headers=ADMIN).json() == {"user_id": "u1", "devices": []}
    # health reports the in-memory database truthfully
    assert admin.get("/admin/v1/health/full").json()["checks"]["database"] == "memory"


def test_health_root_and_inmemory_audit_filters():
    assert admin.get("/health").json()["service"] == "admin-api"
    admin.post("/admin/v1/wallet/adjust", headers=ADMIN,
               json={"user_id": "flt-u", "coins": 10, "reason_code": "goodwill"})
    admin.post("/admin/v1/wallet/adjust", headers=FINANCE,
               json={"user_id": "flt-u", "coins": 11, "reason_code": "goodwill"})
    rows = admin.get("/admin/v1/audit?actor=farah", headers=ADMIN).json()["rows"]
    assert rows and all(r["actor"] == "farah" for r in rows)
    rows = admin.get("/admin/v1/audit?q=goodwill", headers=ADMIN).json()["rows"]
    assert rows and all("goodwill" in str(r["change"]) for r in rows)


def test_flag_noop_paths_and_unknown_dict_override():
    # unknown key with a dict override is ignored by the domain merge
    assert "ghost.flag" not in effective_flags({"ghost.flag": {"enabled": True}})
    # no-op writes short-circuit un-audited, for plain and dict-shaped current
    admin_main.store.flag_overrides["rewards.referral_enabled"] = {
        "enabled": True, "pct": 40}
    r = admin.patch("/admin/v1/config/flags/rewards.referral_enabled",
                    headers=ADMIN, json={"enabled": True, "pct": 40})
    assert r.json() == {"key": "rewards.referral_enabled",
                        "enabled": True, "pct": 40}
    admin_main.store.flag_overrides.pop("rewards.referral_enabled")


def test_core_guest_fallback_and_store_edges(monkeypatch):
    # no Authorization header → the stable dev guest
    assert core.get("/v1/wallet").status_code == 200

    # emit() swallows a broken analytics sink — money paths never die for it
    class BoomShared:
        def event_append(self, **kw):
            raise RuntimeError("sink down")
    monkeypatch.setattr(core_store, "shared", BoomShared(), raising=False)
    core_store.emit("u", "purchase", ref="x", value=1)   # must not raise
    monkeypatch.setattr(core_store, "shared", None, raising=False)

    # refresh_ledger delegates when the ledger implements refresh()
    class R:
        called = False
        def refresh(self):
            R.called = True
    monkeypatch.setattr(core_store, "ledger", R(), raising=False)
    core_store.refresh_ledger()
    assert R.called

    # ensure_free: unknown series is simply not free
    assert core_store.ensure_free("u", "no-such-series", 1) is False


def test_db_runner_close_and_create_all_race(tmp_path, monkeypatch):
    from katha_infra.db import AsyncRunner, Database

    r = AsyncRunner()
    assert r.run(_async_one()) == 1
    r.close()                                    # stops the loop thread

    # a concurrent creator already made the tables → tolerated
    from katha_infra import db as db_mod
    real = db_mod.Base.metadata.create_all
    def race(conn, **kw):
        raise OperationalError("CREATE TABLE", None,
                               Exception("table event already exists"))
    monkeypatch.setattr(db_mod.Base.metadata, "create_all", race)
    Database(f"sqlite+aiosqlite:///{tmp_path/'race.db'}")   # no raise
    # any OTHER operational error still surfaces
    def broken(conn, **kw):
        raise OperationalError("CREATE TABLE", None, Exception("disk I/O error"))
    monkeypatch.setattr(db_mod.Base.metadata, "create_all", broken)
    with pytest.raises(OperationalError):
        Database(f"sqlite+aiosqlite:///{tmp_path/'broken.db'}")
    monkeypatch.setattr(db_mod.Base.metadata, "create_all", real)


async def _async_one():
    return 1


def test_oidc_odd_payloads_and_http_json(monkeypatch):
    import hashlib
    import hmac as hmac_mod

    # a token whose signature verifies but whose body isn't JSON → signed out
    body = "!!!not-base64-json!!!"
    sig = oidc._b64(hmac_mod.new(oidc._SESSION_SECRET, body.encode(),
                                 hashlib.sha256).digest())
    assert oidc.read_payload(f"{body}.{sig}") is None

    # _http_json builds GET and form-POST requests correctly (network mocked)
    seen = {}
    class _Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b'{"ok": true}'
    def fake(req, timeout=0):
        seen["url"] = req.full_url
        seen["ct"] = req.headers.get("Content-type", "")
        seen["data"] = req.data
        return _Resp()
    import urllib.request as _ur
    monkeypatch.setattr(_ur, "urlopen", fake)
    assert oidc._http_json("https://idp.example/.well-known") == {"ok": True}
    assert seen["data"] is None and seen["ct"] == ""
    assert oidc._http_json("https://idp.example/token", data=b"a=1") == {"ok": True}
    assert seen["ct"] == "application/x-www-form-urlencoded"


def test_final_line_sweep(monkeypatch):
    # allowlist: empty entries skipped, CIDR match admits a real IP
    monkeypatch.setenv("KATHA_ADMIN_IP_ALLOWLIST", " , 10.0.0.0/8")
    assert admin_main._ip_allowed("10.1.2.3") is True
    assert admin_main._ip_allowed("11.1.2.3") is False
    monkeypatch.delenv("KATHA_ADMIN_IP_ALLOWLIST")

    # an unhandled endpoint exception rides the middleware's error branch
    def boom():
        raise RuntimeError("kaboom")
    monkeypatch.setattr(admin_main.catalog, "pricing", boom)
    crashy = TestClient(admin_main.app, raise_server_exceptions=False)
    assert crashy.get("/admin/v1/config/policy",
                      headers=ADMIN).status_code == 500
    monkeypatch.undo()

    # _notify: configured webhook + dead network → False, never a raise
    monkeypatch.setenv("KATHA_ALERT_WEBHOOK", "https://hooks.example/x")
    import urllib.request as _ur
    monkeypatch.setattr(_ur, "urlopen",
                        lambda *a, **kw: (_ for _ in ()).throw(OSError("down")))
    assert admin_main._notify("hello") is False

    # _step_up: oidc mode with no session falls through (require() guards it)
    monkeypatch.setenv("KATHA_ADMIN_AUTH", "oidc")
    class FakeReq:
        cookies = {}
    assert admin_main._step_up(FakeReq()) is None
    monkeypatch.setenv("KATHA_ADMIN_AUTH", "headers")

    # flags GET: a plain-bool override renders as pct 100
    admin_main.store.flag_overrides["rewards.referral_enabled"] = True
    flags = {f["key"]: f for f in
             admin.get("/admin/v1/config/flags", headers=ADMIN).json()}
    assert flags["rewards.referral_enabled"] == {
        **flags["rewards.referral_enabled"], "enabled": True, "pct": 100}
    admin_main.store.flag_overrides.pop("rewards.referral_enabled")

    # adjust without a user_id
    assert admin.post("/admin/v1/wallet/adjust", headers=ADMIN,
                      json={"coins": 10, "reason_code": "x"}).status_code == 400

    # status change without persistence lands in the in-memory fallback
    r = admin.post("/admin/v1/catalog/series/kaanch-ka-mahal/status",
                   headers=ADMIN, json={"status": "draft"})
    assert r.status_code == 200
    assert admin_main.store.flag_overrides.pop("status:kaanch-ka-mahal") == "draft"

    # grievance resolve on an unknown id
    assert admin.post("/admin/v1/grievances/G-NOPE/resolve", headers=ADMIN,
                      json={"note": "n"}).status_code in (404, 503)

    # core: grievance intake without persistence refuses honestly
    assert core.post("/v1/grievance", headers={"Authorization": "Bearer g-u"},
                     json={"contact": "a@b", "subject": "s"}).status_code == 503


def test_true_last_lines(tmp_path):
    # PATCH over a plain-bool override reads its current as (bool, 100)
    admin_main.store.flag_overrides["rewards.referral_enabled"] = True
    r = admin.patch("/admin/v1/config/flags/rewards.referral_enabled",
                    headers=ADMIN, json={"enabled": False})
    assert r.json()["enabled"] is False
    admin_main.store.flag_overrides.pop("rewards.referral_enabled", None)

    from katha_infra.db import Database
    db = Database(f"sqlite+aiosqlite:///{tmp_path/'noop.db'}")

    # a second reader folds entitlements another writer created (refresh)
    from katha_infra import PersistentLedger
    from katha_ledger import TxType
    reader = PersistentLedger(db)
    writer = PersistentLedger(db)
    writer.credit("r-u", TxType.PURCHASE, coins=50, reference_type="iap",
                  reference_id="s", idempotency_key="tl1",
                  created_at="2026-09-01T00:00:00+00:00")
    writer.unlock("r-u", episode_ids=["kaanch-ka-mahal:e11"],
                  price_per_episode=30, reference_type="episode",
                  reference_id="kaanch-ka-mahal:e11", idempotency_key="tl2",
                  created_at="2026-09-01T00:00:00+00:00")
    reader.refresh()
    assert reader.is_entitled("r-u", "kaanch-ka-mahal:e11")


def test_comms_endpoints_without_persistence():
    assert core.post("/v1/push/register", headers={"Authorization": "Bearer u"},
                     json={"token": "t"}).status_code == 503
    assert core.get("/v1/me/invoices",
                    headers={"Authorization": "Bearer u"}).json() == {"invoices": []}
    ob = admin.get("/admin/v1/outbox", headers=ADMIN).json()
    assert ob == {"rows": [], "transports": {"email": False, "push": False}}
    assert admin.post("/admin/v1/catalog/series/kaanch-ka-mahal/notify-drop",
                      headers=ADMIN, json={"episode": 2}).status_code == 503
    # grievance email helper is a silent no-op without the shared store
    admin_main._grievance_email("G-X", "acknowledged", "msg")


def test_invoice_register_and_merge_without_persistence():
    assert admin.get("/admin/v1/invoices", headers=ADMIN).json()["totals"]["count"] == 0
    # merging into oneself is a no-op
    assert core_store.merge_guest("guest-dev", "guest-dev") is None


def test_retry_and_recs_without_persistence():
    # Outbox retry needs the shared store.
    assert admin.post("/admin/v1/outbox/1/retry",
                      headers=ADMIN).status_code == 503
    # CSV register is just the header line without persistence.
    csv = admin.get("/admin/v1/invoices.csv", headers=ADMIN)
    assert csv.status_code == 200 and csv.text.strip().count("\n") == 0
    # A signed-in viewer with no watch history gets no personal rail,
    # and trending falls back to catalog order (no events store).
    tok = core.post("/v1/auth/guest").json()["access_token"]
    rows = core.get("/v1/home",
                    headers={"Authorization": f"Bearer {tok}"}).json()["rows"]
    assert [r["title"] for r in rows] == ["Trending in हिन्दी", "New this week"]

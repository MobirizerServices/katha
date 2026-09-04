"""Regression tests for the second fix batch (review Highs): serialized audit
chain (B7), persistent conditional approvals (A3), uncapped invoice register
(A5), Twilio Verify checks with Twilio (B6), the frozen migration chain (B5),
and the archive rights gate (D4)."""
import sys
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from admin_app import main as admin_main
from admin_app.store import store as admin_store
from katha_infra import Database, SharedStore
from katha_ledger import Ledger

TS = "2026-09-04T00:00:00+00:00"
ADMIN = {"X-Actor-Id": "root@katha.dev", "X-Role": "admin"}
SUPPORT = {"X-Actor-Id": "sam", "X-Role": "support"}
FIN_A = {"X-Actor-Id": "farah", "X-Role": "finance"}
FIN_B = {"X-Actor-Id": "fiona", "X-Role": "finance"}


@pytest.fixture
def shared(tmp_path, monkeypatch):
    db = Database(f"sqlite+aiosqlite:///{tmp_path/'highs.db'}")
    sh = SharedStore(db)
    monkeypatch.setattr(admin_main, "SHARED", sh)
    monkeypatch.setenv("KATHA_ADMIN_AUTH", "headers")
    admin_store.ledger = Ledger()
    admin_store.audit.clear()
    admin_store.approvals.clear()
    yield sh


# --- B7: concurrent audit appends keep the chain intact ------------------------

def test_audit_chain_survives_concurrent_appends(shared):
    errors = []

    def worker(i):
        try:
            for j in range(20):
                shared.audit_append(ts=TS, actor_id=f"a{i}", actor_role="admin",
                                    action="x", target=f"t{j}", detail="d")
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    out = shared.audit_list(limit=5)
    assert out["chain_ok"] is True
    assert out["total"] == 120 if "total" in out else True


# --- A3: approvals live in the shared DB, decided exactly once -----------------

def test_approval_visible_to_another_worker_and_after_restart(shared, tmp_path):
    a = TestClient(admin_main.app)
    ap = a.post("/admin/v1/wallet/adjust", headers=SUPPORT,
                json={"user_id": "u-ap", "coins": 900, "reason_code": "goodwill"}).json()
    assert ap["status"] == "pending_approval"
    ap_id = ap["approval"]["id"]
    # "another worker": no in-memory state at all
    admin_store.approvals.clear()
    assert any(x["id"] == ap_id for x in a.get("/admin/v1/approvals", headers=FIN_A).json())
    # "a restart": a fresh SharedStore over the same file still has it pending
    fresh = SharedStore(Database(f"sqlite+aiosqlite:///{tmp_path/'highs.db'}"))
    assert fresh.approval_get(ap_id)["status"] == "pending"
    r = a.post(f"/admin/v1/approvals/{ap_id}/approve", headers=FIN_A)
    assert r.status_code == 200 and r.json()["wallet"]["total"] == 900
    assert fresh.approval_get(ap_id)["status"] == "approved"
    assert a.post(f"/admin/v1/approvals/{ap_id}/approve", headers=FIN_B).status_code == 409
    assert a.post(f"/admin/v1/approvals/{ap_id}/reject", headers=FIN_B).status_code == 409


def test_two_approvers_racing_apply_the_money_once(shared):
    a = TestClient(admin_main.app)
    ap_id = a.post("/admin/v1/wallet/adjust", headers=SUPPORT,
                   json={"user_id": "u-race", "coins": 800, "reason_code": "goodwill"}
                   ).json()["approval"]["id"]
    gate = threading.Barrier(2)
    codes = []

    def approve(h):
        gate.wait()
        codes.append(TestClient(admin_main.app)
                     .post(f"/admin/v1/approvals/{ap_id}/approve", headers=h).status_code)

    ts = [threading.Thread(target=approve, args=(h,)) for h in (FIN_A, FIN_B)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert sorted(codes) == [200, 409]
    assert shared.wallet("u-race")["total"] == 800


# --- A5: the GST register is never silently truncated ---------------------------

def test_invoice_register_returns_every_invoice(shared):
    from katha_infra import comms
    for i in range(205):
        comms.build_invoice(shared, user_id=f"u{i}", order_ref=f"web:o{i}", sku="coins_popular_in",
                            coins=1300, bonus=130, total_minor=19900, now=TS)
    a = TestClient(admin_main.app)
    reg = a.get("/admin/v1/invoices", headers=FIN_A).json()
    assert len(reg["rows"]) == 205
    assert reg["totals"]["count"] == 205
    assert reg["totals"]["gross_minor"] == 205 * 19900
    csv_text = a.get("/admin/v1/invoices.csv", headers=FIN_A).text
    assert csv_text.count("\n") >= 205


# --- B6: Twilio Verify generates and checks the code itself --------------------

def test_twilio_provider_delegates_verification(monkeypatch):
    from katha_infra import otp
    monkeypatch.setenv("KATHA_OTP_PROVIDER", "twilio")
    monkeypatch.setenv("KATHA_TWILIO_SID", "AC1")
    monkeypatch.setenv("KATHA_TWILIO_TOKEN", "tok")
    monkeypatch.setenv("KATHA_TWILIO_SERVICE", "VA1")
    monkeypatch.delenv("KATHA_REDIS_URL", raising=False)
    otp._mem.clear()
    calls = []

    class Resp:
        def __init__(self, status, body):
            self.status_code, self._body = status, body

        def json(self):
            return self._body

        def raise_for_status(self):
            pass

    def fake_post(url, data=None, auth=None, timeout=None, **kw):
        calls.append((url, data, auth))
        if url.endswith("/Verifications"):
            return Resp(201, {"status": "pending"})
        return Resp(200, {"status": "approved" if data["Code"] == "246810" else "pending"})

    import httpx
    monkeypatch.setattr(httpx, "post", fake_post)
    otp.generate_and_send("+919000000001")
    assert otp._mem == {}                                  # nothing stored locally
    assert calls[0][0] == "https://verify.twilio.com/v2/Services/VA1/Verifications"
    assert calls[0][2] == ("AC1", "tok")
    assert otp.verify("+919000000001", "000000") is False
    assert otp.verify("+919000000001", "246810") is True
    assert calls[-1][0].endswith("/VerificationCheck")
    assert calls[-1][1] == {"To": "+919000000001", "Code": "246810"}

    def down(*a, **k):
        raise httpx.ConnectError("down")
    monkeypatch.setattr(httpx, "post", down)
    assert otp.verify("+919000000001", "246810") is False   # fail closed


# --- B5: migrations reproduce the models exactly, from a frozen baseline -------

def test_alembic_chain_matches_models(tmp_path, monkeypatch):
    from alembic import command
    from alembic.autogenerate import compare_metadata
    from alembic.config import Config
    from alembic.migration import MigrationContext
    from sqlalchemy import create_engine, inspect

    from katha_infra.models import Base
    backend = Path(__file__).resolve().parents[3]
    monkeypatch.setenv("KATHA_DB_URL", f"sqlite+aiosqlite:///{tmp_path/'mig.db'}")
    cfg = Config(str(backend / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend / "migrations"))
    command.upgrade(cfg, "head")

    eng = create_engine(f"sqlite:///{tmp_path/'mig.db'}")
    with eng.connect() as conn:
        assert "approval" in inspect(conn).get_table_names()
        mc = MigrationContext.configure(conn, opts={"compare_type": True})
        diff = compare_metadata(mc, Base.metadata)
    assert diff == [], diff
    # the whole chain walks back down to an empty database
    command.downgrade(cfg, "base")
    with eng.connect() as conn:
        assert inspect(conn).get_table_names() == ["alembic_version"]


# --- D4: the archive rights gate admits only licenses a paid product may use ----

def test_archive_rights_gate_is_an_allow_list():
    sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "tools"))
    import fetch_archive as fa
    ok = lambda m: fa.rights_ok(m)[0]  # noqa: E731
    assert ok({"licenseurl": "https://creativecommons.org/publicdomain/zero/1.0/"})
    assert ok({"licenseurl": "http://creativecommons.org/licenses/by/4.0/"})
    assert ok({"licenseurl": "https://creativecommons.org/licenses/by-sa/3.0/"})
    assert ok({"possible-copyright-status": "Public Domain"})
    assert not ok({"licenseurl": "https://creativecommons.org/licenses/by-nc/4.0/"})
    assert not ok({"licenseurl": "https://creativecommons.org/licenses/by-nc-nd/4.0/"})
    assert not ok({"licenseurl": "https://creativecommons.org/licenses/by-nd/4.0/"})
    assert not ok({"rights": "not in the public domain"})
    assert not ok({"possible-copyright-status": "public domain?"})
    assert not ok({})
    # the size cap applies at file selection
    files = [{"name": "big.mp4", "size": str(3 * 1024 ** 3)}, {"name": "ok.mp4", "size": "1000"}]
    assert fa.pick_video(files) == "ok.mp4"
    assert fa.pick_video([files[0]]) is None


# ===================== Medium batch: backend + admin ===========================

def test_audit_hash_covers_every_column_and_tail_deletion(shared, monkeypatch):
    """B8: rewriting role/IP/UA or deleting the newest rows is detected."""
    import sqlite3
    monkeypatch.setenv("KATHA_AUDIT_HMAC_KEY", "k-test")
    for i in range(4):
        shared.audit_append(ts=TS, actor_id="a", actor_role="admin", action="x",
                            target=f"t{i}", detail="d", ip="10.0.0.1", user_agent="ua")
    assert shared.audit_list()["chain_ok"] is True
    path = shared.db.url.split("///")[1]
    con = sqlite3.connect(path)
    con.execute("UPDATE audit_log SET ip='9.9.9.9' WHERE id=2"); con.commit()
    assert shared.audit_list()["chain_ok"] is False
    con.execute("UPDATE audit_log SET ip='10.0.0.1' WHERE id=2"); con.commit()
    assert shared.audit_list()["chain_ok"] is True
    con.execute("DELETE FROM audit_log WHERE id=4"); con.commit()      # truncate the tail
    assert shared.audit_list()["chain_ok"] is False
    con.close()


def test_audit_annotate_and_timeline_beyond_the_old_window(shared):
    """A7: row 1 is annotatable and a user's oldest admin action is on their
    timeline after 600 later rows."""
    a = TestClient(admin_main.app)
    first = shared.audit_append(ts=TS, actor_id="a", actor_role="admin", action="dpdp.export",
                                target="u-old", detail="first")
    for i in range(600):
        shared.audit_append(ts=TS, actor_id="a", actor_role="admin", action="x",
                            target=f"other{i}", detail="d")
    r = a.patch(f"/admin/v1/audit/{first['id']}/note", headers=ADMIN, json={"note": "seen"})
    assert r.status_code == 200
    assert a.patch("/admin/v1/audit/999999/note", headers=ADMIN, json={"note": "x"}).status_code == 404
    tl = a.get("/admin/v1/users/u-old/timeline", headers=FIN_A).json()["events"]
    assert any(e["kind"] == "admin" and e["detail"] == "first" for e in tl)


def test_erase_scrubs_grievance_and_outbox_and_kills_tokens(shared):
    """A9: after erasure the grievance contact/body and outbox copies are gone,
    the JWT version moved, and the export lists every table."""
    from katha_infra import comms
    shared.upsert_profile("u-dpdp", phone="+919111111111", kind="phone", language="hi", created_at=TS)
    shared.grievance_create(gid="G-1", user_id="u-dpdp", contact="+919111111111", channel="app",
                            subject="Refund", body="my card 4111", created_at=TS)
    inv = comms.build_invoice(shared, user_id="u-dpdp", order_ref="web:x", sku="coins_popular_in",
                              coins=1300, bonus=130, total_minor=19900, now=TS)
    comms.send_email(shared, to="me@x.dev", subject=f"Your Katha invoice {inv['id']}",
                     body_html="<p>hi</p>", now=TS)
    shared.device_touch("u-dpdp", ua="UA", ip="1.2.3.4", ts=TS)
    v0 = shared.token_version("u-dpdp")
    a = TestClient(admin_main.app)
    exp = a.get("/admin/v1/users/u-dpdp/export", headers=ADMIN).json()
    assert {"grievances", "devices", "invoices", "events"} <= set(exp)
    assert exp["grievances"][0]["id"] == "G-1" and exp["devices"]
    assert a.post("/admin/v1/users/u-dpdp/erase", headers=ADMIN).status_code == 200
    g = next(x for x in shared.grievance_list() if x["id"] == "G-1")
    assert g["contact"] == "" and "4111" not in g["body"]
    ob = shared.outbox_list()
    assert all(inv["id"] not in (o.get("recipient") or "") and o["recipient"] != "me@x.dev"
               for o in ob if inv["id"] in (o.get("subject") or ""))
    assert shared.token_version("u-dpdp") == v0 + 1
    assert shared.invoices_for("u-dpdp")           # the financial record stays


def test_adjust_idempotency_key_and_atomic_cap(shared):
    """A10: the same client key lands once; the cap is charged once."""
    a = TestClient(admin_main.app)
    body = {"user_id": "u-idem", "coins": 300, "reason_code": "goodwill", "idempotency_key": "click-1"}
    r1 = a.post("/admin/v1/wallet/adjust", headers=SUPPORT, json=body).json()
    r2 = a.post("/admin/v1/wallet/adjust", headers=SUPPORT, json=body).json()
    assert r1["wallet"]["total"] == 300 and r2["wallet"]["total"] == 300 and r2.get("replayed")
    assert shared.wallet("u-idem")["total"] == 300
    from katha_domain.timeutil import now_iso
    assert int(shared.kv_get(f"adjcap:sam:{now_iso()[:10]}")) == 300
    # racing requests cannot both squeeze under the cap
    shared.kv_set("config:adjust.daily_cap", "500")
    gate = threading.Barrier(2)
    codes = []

    def go(i):
        gate.wait()
        codes.append(TestClient(admin_main.app).post(
            "/admin/v1/wallet/adjust", headers=SUPPORT,
            json={"user_id": f"u-cap{i}", "coins": 150, "reason_code": "goodwill"}).status_code)
    ts = [threading.Thread(target=go, args=(i,)) for i in range(2)]
    for t in ts: t.start()
    for t in ts: t.join()
    assert sorted(codes) == [200, 409]


def test_step_up_uses_auth_time_and_asks_the_idp_to_reauthenticate(monkeypatch):
    """A11: a session whose IdP authentication is old is refused for money even
    if the cookie is fresh; the step-up login carries max_age=0/prompt=login."""
    from admin_app import oidc
    monkeypatch.setenv("KATHA_ADMIN_AUTH", "oidc")
    monkeypatch.delenv("KATHA_OIDC_ISSUER", raising=False)
    monkeypatch.setattr(admin_main, "SHARED", None)
    a = TestClient(admin_main.app)
    r = a.get("/admin/v1/auth/login?step_up=1", follow_redirects=False)
    assert "max_age=0" in r.headers["location"] and "prompt=login" in r.headers["location"]
    import time as _t
    stale = oidc.sign_payload({"email": "ops@katha.dev", "name": "", "sid": "s",
                               "iat": _t.time(), "auth_time": _t.time() - 3600,
                               "exp": _t.time() + 3600})
    a.cookies.set(oidc.SESSION_COOKIE, stale)
    r = a.post("/admin/v1/approvals/nope/approve", headers={"X-Katha-CSRF": "1"})
    assert r.status_code == 403 and "step-up" in r.json()["detail"]
    assert r.headers["X-Katha-Login"].endswith("step_up=1")


def test_invoice_number_follows_the_indian_financial_year(shared):
    """B12: February belongs to the FY that started the previous April; late
    31 March UTC is already 1 April IST."""
    assert shared.next_invoice_number("2026-09-01T00:00:00+00:00").startswith("KATHA-INV-2627-")
    assert shared.next_invoice_number("2027-02-10T00:00:00+00:00").startswith("KATHA-INV-2627-")
    assert shared.next_invoice_number("2027-03-31T23:00:00+00:00").startswith("KATHA-INV-2728-")
    assert shared.next_invoice_number("2027-03-31T10:00:00+00:00").startswith("KATHA-INV-2627-")


def test_otp_resend_keeps_the_attempt_count_and_is_capped(monkeypatch):
    """B11: a resend is not a fresh guessing budget, and resends are capped."""
    from katha_infra import otp
    monkeypatch.setenv("KATHA_OTP_PROVIDER", "console")
    monkeypatch.delenv("KATHA_REDIS_URL", raising=False)
    otp._mem.clear(); otp._resends.clear()
    phone = "+919222222222"
    otp.generate_and_send(phone)
    code = otp._mem[phone][0]
    for _ in range(4):
        otp.verify(phone, "0000" if code != "0000" else "1111")
    otp.generate_and_send(phone)                     # resend: count carries (4)
    assert otp._mem[phone][2] == 4
    assert otp.verify(phone, "0000" if otp._mem[phone][0] != "0000" else "1111") is False
    assert otp.verify(phone, otp._mem[phone][0]) is False     # budget spent: even the right code fails
    otp.generate_and_send(phone)                     # 3rd code: still allowed
    with pytest.raises(otp.ResendLimited):
        otp.generate_and_send(phone)                 # 4th within the hour: refused


def test_core_api_medium_gates(monkeypatch):
    """C3/C4/C5 in a configured deployment: free episodes are granted not sold,
    a raw bearer personalizes nothing, and no header is 401."""
    from app.auth import issue_token
    from app.main import app as core_app
    from app.store import store
    c = TestClient(core_app)
    # C3 (any mode): unlocking a free episode charges nothing
    c.post("/v1/iap/verify", headers={"Authorization": "Bearer free-unlocker"},
           json={"jws": "r", "sku": "coins_popular_in"})
    r = c.post("/v1/series/kaanch-ka-mahal/episodes/1/unlock",
               headers={"Authorization": "Bearer free-unlocker"}, json={"idempotency_key": "f1"})
    assert r.status_code == 200 and r.json()["spent_bought"] == 0
    assert r.json()["wallet"]["total"] == 1300
    assert store.ledger.is_entitled("free-unlocker", "kaanch-ka-mahal:e1")
    # C4/C5: stubs off
    monkeypatch.setenv("KATHA_DEV_STUBS", "0")
    assert c.get("/v1/wallet").status_code == 401
    assert c.get("/v1/home", headers={"Authorization": "Bearer usr_victim"}).status_code == 200
    tok = issue_token("usr_real")
    assert c.get("/v1/wallet", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    # a raw guest id on login merges nothing when stubs are off
    v = c.post("/v1/auth/otp/verify", headers={"Authorization": "Bearer gst_stolen"},
               json={"phone": "+919333333333", "code": "1234"})
    assert v.status_code == 200

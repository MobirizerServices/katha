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

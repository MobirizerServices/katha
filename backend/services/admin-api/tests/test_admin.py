"""Admin-api tests: RBAC gating, audit trail, and the dual-approval flow."""
import pytest
from fastapi.testclient import TestClient

from admin_app.main import app
from admin_app import store as store_mod
from katha_ledger import TxType

client = TestClient(app)

SUPPORT = {"X-Actor-Id": "op-support", "X-Role": "support"}
SUPPORT2 = {"X-Actor-Id": "op-support-2", "X-Role": "support"}
FINANCE = {"X-Actor-Id": "op-finance", "X-Role": "finance"}
CONTENT = {"X-Actor-Id": "op-content", "X-Role": "content"}
ADMIN = {"X-Actor-Id": "op-admin", "X-Role": "admin"}


@pytest.fixture(autouse=True)
def reset():
    store_mod.reset()
    yield


# ---- RBAC ------------------------------------------------------------------
def test_missing_actor_is_401():
    assert client.get("/admin/v1/series").status_code == 401


def test_unknown_role_is_401():
    r = client.get("/admin/v1/series", headers={"X-Actor-Id": "x", "X-Role": "wizard"})
    assert r.status_code == 401


def test_wrong_role_is_403():
    # support may not publish catalog.
    r = client.post("/admin/v1/series/kaanch-ka-mahal/publish", headers=SUPPORT)
    assert r.status_code == 403


def test_admin_is_allowed_everywhere():
    assert client.get("/admin/v1/series", headers=ADMIN).status_code == 200
    assert client.get("/admin/v1/audit", headers=ADMIN).status_code == 200


# ---- catalog ---------------------------------------------------------------
def test_list_and_publish_series():
    r = client.get("/admin/v1/series", headers=CONTENT)
    assert r.status_code == 200 and len(r.json()) == 14
    assert all(not s["published"] for s in r.json())

    p = client.post("/admin/v1/series/kaanch-ka-mahal/publish", headers=CONTENT)
    assert p.status_code == 200 and p.json()["published"] is True

    after = client.get("/admin/v1/series", headers=CONTENT).json()
    assert next(s for s in after if s["slug"] == "kaanch-ka-mahal")["published"] is True
    # publish is a mutation -> audited.
    audit = client.get("/admin/v1/audit", headers=ADMIN).json()
    assert any(a["action"] == "series.publish" for a in audit)


def test_publish_unknown_series_404():
    assert client.post("/admin/v1/series/nope/publish", headers=CONTENT).status_code == 404


# ---- wallet adjust ---------------------------------------------------------
def test_small_adjust_applies_immediately_and_audits():
    r = client.post("/admin/v1/wallet/adjust", headers=SUPPORT,
                    json={"user_id": "u1", "coins": 100, "reason_code": "goodwill"})
    assert r.status_code == 200 and r.json()["status"] == "applied"
    assert r.json()["wallet"]["total"] == 100

    ledger = client.get("/admin/v1/users/u1/ledger", headers=FINANCE).json()
    assert ledger["wallet"]["total"] == 100
    assert ledger["transactions"][0]["type"] == TxType.ADMIN_ADJUST.value

    audit = client.get("/admin/v1/audit", headers=ADMIN).json()
    assert any(a["action"] == "wallet.adjust.applied" for a in audit)


def test_adjust_requires_reason_code():
    r = client.post("/admin/v1/wallet/adjust", headers=SUPPORT,
                    json={"user_id": "u1", "coins": 100})
    assert r.status_code == 400


def test_adjust_rejects_zero_coins():
    r = client.post("/admin/v1/wallet/adjust", headers=SUPPORT,
                    json={"user_id": "u1", "coins": 0, "reason_code": "x"})
    assert r.status_code == 400


# ---- dual approval ---------------------------------------------------------
def _create_pending() -> str:
    r = client.post("/admin/v1/wallet/adjust", headers=SUPPORT,
                    json={"user_id": "big", "coins": 600, "reason_code": "refund_correction"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "pending_approval"
    # NOT applied yet.
    assert client.get("/admin/v1/users/big/ledger", headers=FINANCE).json()["wallet"]["total"] == 0
    return body["approval"]["id"]


def test_large_adjust_requires_dual_approval_and_does_not_apply():
    _create_pending()


def test_requester_cannot_self_approve():
    ap_id = _create_pending()
    # Same person (op-support) tries to approve — even elevated to finance role.
    r = client.post(f"/admin/v1/approvals/{ap_id}/approve",
                    headers={"X-Actor-Id": "op-support", "X-Role": "finance"})
    assert r.status_code == 403
    assert client.get("/admin/v1/users/big/ledger", headers=FINANCE).json()["wallet"]["total"] == 0


def test_second_actor_approves_and_applies():
    ap_id = _create_pending()
    r = client.post(f"/admin/v1/approvals/{ap_id}/approve", headers=FINANCE)
    assert r.status_code == 200 and r.json()["status"] == "applied"
    assert r.json()["wallet"]["total"] == 600
    # Second approval attempt is a conflict.
    assert client.post(f"/admin/v1/approvals/{ap_id}/approve", headers=ADMIN).status_code == 409
    # Both the request and the approval are in the audit trail.
    actions = [a["action"] for a in client.get("/admin/v1/audit", headers=ADMIN).json()]
    assert "wallet.adjust.requested" in actions and "wallet.adjust.approved" in actions


def test_approve_unknown_is_404():
    assert client.post("/admin/v1/approvals/nope/approve", headers=FINANCE).status_code == 404


def test_negative_large_adjust_also_needs_approval():
    r = client.post("/admin/v1/wallet/adjust", headers=SUPPORT,
                    json={"user_id": "u9", "coins": -800, "reason_code": "clawback"})
    assert r.json()["status"] == "pending_approval"


# ---- users list ------------------------------------------------------------
def test_users_list_reflects_adjusted_users():
    client.post("/admin/v1/wallet/adjust", headers=SUPPORT,
                json={"user_id": "u1", "coins": 50, "reason_code": "g"})
    users = client.get("/admin/v1/users", headers=FINANCE).json()
    assert any(u["id"] == "u1" for u in users)          # AdminUser shape (id, wallet, ...)

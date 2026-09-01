"""The back-office views' live endpoints: overview, catalog shape, approvals
list/reject, flag overrides reaching /v1/config-style merges, audit shape."""
import pytest
from fastapi.testclient import TestClient

from admin_app.main import app
from admin_app.store import store
from katha_ledger import Ledger

client = TestClient(app)
ADMIN = {"X-Actor-Id": "riya", "X-Role": "admin"}
FINANCE = {"X-Actor-Id": "farah", "X-Role": "finance"}
SUPPORT = {"X-Actor-Id": "sam", "X-Role": "support"}


@pytest.fixture(autouse=True)
def reset():
    store.ledger = Ledger()
    store.audit.clear()
    store.approvals.clear()
    store.known_users.clear()
    store.flag_overrides.clear()
    yield


def test_overview_live_counters():
    client.post("/admin/v1/wallet/adjust", headers=SUPPORT,
                json={"user_id": "u1", "coins": 100, "reason_code": "goodwill"})
    r = client.get("/admin/v1/overview", headers=ADMIN)
    assert r.status_code == 200
    body = r.json()
    labels = {k["label"]: k["value"] for k in body["kpis"]}
    assert labels["Registered users"] == "1"
    assert labels["Coins outstanding"] == "100"
    assert body["attention"] == [] and body["pipeline"] == []


def test_catalog_series_client_shape():
    r = client.get("/admin/v1/catalog/series", headers=ADMIN)
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 14                      # the live originals, not a mock
    first = rows[0]
    for key in ("slug", "title", "episodeCount", "freeEpisodes", "coinPrice",
                "bundleDiscountPct", "rating", "language", "status"):
        assert key in first
    assert first["freeEpisodes"] == 10 and first["coinPrice"] == 30


def test_approvals_list_and_reject_flow():
    # Above threshold -> queued, listed, then rejected with audit.
    r = client.post("/admin/v1/wallet/adjust", headers=SUPPORT,
                    json={"user_id": "u2", "coins": 900, "reason_code": "refund"})
    ap_id = r.json()["approval"]["id"]

    listed = client.get("/admin/v1/approvals", headers=FINANCE).json()
    assert [a["id"] for a in listed] == [ap_id]
    assert listed[0]["amount"] == 900 and listed[0]["userId"] == "u2"
    assert "reason: refund" in listed[0]["detail"]

    rj = client.post(f"/admin/v1/approvals/{ap_id}/reject", headers=FINANCE,
                     json={"note": "not eligible"})
    assert rj.json()["status"] == "rejected"
    assert client.get("/admin/v1/approvals", headers=FINANCE).json() == []
    # rejecting twice conflicts
    assert client.post(f"/admin/v1/approvals/{ap_id}/reject", headers=FINANCE).status_code == 409
    # nothing was applied to the ledger
    assert store.ledger.balance("u2").total == 0
    audit = client.get("/admin/v1/audit", headers=ADMIN).json()["rows"]
    assert any(a["action"] == "wallet.adjust.rejected" for a in audit)


def test_reject_unknown_approval_404():
    assert client.post("/admin/v1/approvals/apr_missing/reject",
                       headers=FINANCE).status_code == 404


def test_flags_read_toggle_and_audit():
    flags = {f["key"]: f for f in client.get("/admin/v1/config/flags", headers=ADMIN).json()}
    assert flags["rewards.checkin_enabled"]["enabled"] is True
    assert flags["rewards.referral_enabled"]["enabled"] is False

    r = client.patch("/admin/v1/config/flags/rewards.referral_enabled",
                     headers=ADMIN, json={"enabled": True})
    assert r.json() == {"key": "rewards.referral_enabled", "enabled": True, "pct": 100}
    flags = {f["key"]: f for f in client.get("/admin/v1/config/flags", headers=ADMIN).json()}
    assert flags["rewards.referral_enabled"]["enabled"] is True

    assert client.patch("/admin/v1/config/flags/not.a.flag",
                        headers=ADMIN, json={"enabled": True}).status_code == 404
    audit = client.get("/admin/v1/audit", headers=ADMIN).json()["rows"]
    assert any(a["action"] == "config.flag.set" and a["entity"] == "rewards.referral_enabled"
               for a in audit)


def test_audit_rows_carry_client_shape():
    client.post("/admin/v1/wallet/adjust", headers=SUPPORT,
                json={"user_id": "u3", "coins": 10, "reason_code": "goodwill"})
    row = client.get("/admin/v1/audit", headers=ADMIN).json()["rows"][-1]
    for key in ("ts", "actor", "action", "entity", "change"):
        assert key in row
    assert "coins=10" in row["change"]

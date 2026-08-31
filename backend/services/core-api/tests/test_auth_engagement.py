"""Tests for the JWT auth, profile, and engagement endpoints."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.store import store
from katha_ledger import Ledger

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_state():
    store.ledger = Ledger()
    store.users.clear()
    store.engagement.clear()
    yield


# ---- auth -----------------------------------------------------------------
def test_otp_flow_issues_jwt_and_me_works():
    r = client.post("/v1/auth/otp/request", json={"phone": "+919812345678"})
    assert r.status_code == 200 and r.json()["phone"] == "+919812345678"

    r = client.post("/v1/auth/otp/verify", json={"phone": "+919812345678", "code": "1234"})
    assert r.status_code == 200
    body = r.json()
    token = body["access_token"]
    assert body["user"]["kind"] == "phone"

    me = client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["user_id"] == body["user"]["user_id"]


def test_otp_same_phone_same_user():
    a = client.post("/v1/auth/otp/verify", json={"phone": "+9111", "code": "0000"}).json()
    b = client.post("/v1/auth/otp/verify", json={"phone": "+9111", "code": "9999"}).json()
    assert a["user"]["user_id"] == b["user"]["user_id"]


def test_otp_rejects_non_4_digit_code():
    r = client.post("/v1/auth/otp/verify", json={"phone": "+9111", "code": "12"})
    assert r.status_code == 400


def test_guest_and_apple_stub():
    g = client.post("/v1/auth/guest")
    assert g.status_code == 200 and g.json()["user"]["kind"] == "guest"
    a = client.post("/v1/auth/apple", json={"identity_token": "fake-apple-jws", "full_name": "Asha"})
    assert a.status_code == 200 and a.json()["user"]["kind"] == "apple"
    assert a.json()["user"]["display_name"] == "Asha"


def test_patch_me_updates_language():
    tok = client.post("/v1/auth/guest").json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    r = client.patch("/v1/me", headers=h, json={"display_name": "Ravi", "language": "ta"})
    assert r.status_code == 200
    assert r.json()["display_name"] == "Ravi" and r.json()["language"] == "ta"
    assert client.patch("/v1/me", headers=h, json={"language": "xx"}).status_code == 400


def test_raw_bearer_still_identifies_user_for_backcompat():
    # The existing harness passes a raw user id as the bearer token.
    r = client.get("/v1/me", headers={"Authorization": "Bearer test-user-1"})
    assert r.status_code == 200 and r.json()["user_id"] == "test-user-1"


# ---- engagement -----------------------------------------------------------
AUTH = {"Authorization": "Bearer eng-user"}


def test_progress_batch_and_continue():
    body = {"items": [
        {"slug": "kaanch-ka-mahal", "number": 3, "position_ms": 15000, "duration_ms": 60000},
        {"slug": "ceo-sahab", "number": 1, "position_ms": 60000, "duration_ms": 60000},
    ]}
    r = client.put("/v1/progress", headers=AUTH, json=body)
    assert r.status_code == 200
    cont = client.get("/v1/me/continue", headers=AUTH).json()["items"]
    # Finished episode (ceo-sahab 1) is excluded; only the in-progress one remains.
    assert len(cont) == 1
    assert cont[0]["slug"] == "kaanch-ka-mahal"
    assert cont[0]["percent"] == 25


def test_progress_unknown_episode_404():
    r = client.put("/v1/progress", headers=AUTH,
                   json={"items": [{"slug": "nope", "number": 1, "position_ms": 1, "duration_ms": 2}]})
    assert r.status_code == 404


def test_my_list_add_remove():
    r = client.put("/v1/me/list/kaanch-ka-mahal", headers=AUTH)
    assert r.status_code == 200 and "kaanch-ka-mahal" in r.json()["slugs"]
    assert len(r.json()["series"]) == 1
    r = client.delete("/v1/me/list/kaanch-ka-mahal", headers=AUTH)
    assert r.json()["slugs"] == []


def test_my_list_unknown_series_404():
    assert client.put("/v1/me/list/not-real", headers=AUTH).status_code == 404


def test_checkin_is_idempotent_per_day_and_grants_bonus():
    r1 = client.post("/v1/rewards/checkin", headers=AUTH).json()
    assert r1["granted_coins"] == 5 and r1["already_claimed"] is False
    assert r1["wallet"]["balance_bonus"] == 5
    r2 = client.post("/v1/rewards/checkin", headers=AUTH).json()
    assert r2["already_claimed"] is True and r2["granted_coins"] == 0
    assert r2["wallet"]["balance_bonus"] == 5  # not double-credited

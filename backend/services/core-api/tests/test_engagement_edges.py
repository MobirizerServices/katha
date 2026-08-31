"""Coverage for engagement projections, list endpoint, auth guards, and free-grant edges."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.store import store
from katha_ledger import Ledger

client = TestClient(app)
AUTH = {"Authorization": "Bearer eng-user"}


@pytest.fixture(autouse=True)
def reset():
    store.ledger = Ledger()
    store.users.clear()
    store.engagement.clear()
    yield


def test_list_get_and_progress_reorders_continue():
    # empty list endpoint
    assert client.get("/v1/me/list", headers=AUTH).json()["slugs"] == []
    # add two, then re-adding one moves it to the front (store.py reorder branch)
    client.put("/v1/me/list/kaanch-ka-mahal", headers=AUTH)
    client.put("/v1/me/list/ceo-sahab", headers=AUTH)
    client.put("/v1/me/list/kaanch-ka-mahal", headers=AUTH)  # re-add -> front
    slugs = client.get("/v1/me/list", headers=AUTH).json()["slugs"]
    assert slugs[0] == "kaanch-ka-mahal"
    # remove one
    client.delete("/v1/me/list/ceo-sahab", headers=AUTH)
    assert "ceo-sahab" not in client.get("/v1/me/list", headers=AUTH).json()["slugs"]


def test_progress_reorders_and_continue_excludes_finished():
    client.put("/v1/progress", headers=AUTH, json={"items": [
        {"slug": "kaanch-ka-mahal", "number": 3, "position_ms": 1000, "duration_ms": 60000},
        {"slug": "ceo-sahab", "number": 5, "position_ms": 60000, "duration_ms": 60000},  # finished
    ]})
    # re-record the first to hit the reorder branch
    client.put("/v1/progress", headers=AUTH, json={"items": [
        {"slug": "kaanch-ka-mahal", "number": 3, "position_ms": 2000, "duration_ms": 60000},
    ]})
    cont = client.get("/v1/me/continue", headers=AUTH).json()
    slugs = [i["slug"] for i in cont["items"]]
    assert "kaanch-ka-mahal" in slugs
    assert "ceo-sahab" not in slugs  # finished episodes are excluded


def test_otp_request_empty_phone_is_400():
    r = client.post("/v1/auth/otp/request", json={"phone": "   "})
    assert r.status_code == 400


def test_apple_auth_missing_token_is_400():
    r = client.post("/v1/auth/apple", json={"identity_token": ""})
    assert r.status_code == 400


def test_playback_unknown_series_free_grant_returns_false(monkeypatch):
    # ensure_free on a missing series returns False (store.py guard) -> 404 at the route
    r = client.post("/v1/series/no-such-series/episodes/1/playback", headers=AUTH)
    assert r.status_code == 404


def test_list_series_endpoint():
    r = client.get("/v1/series")
    assert r.status_code == 200 and len(r.json()) == 14

"""Error-path + edge coverage for the core-api money and catalog routers."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.store import store
from katha_ledger import Ledger

client = TestClient(app)
AUTH = {"Authorization": "Bearer err-user"}


@pytest.fixture(autouse=True)
def reset():
    store.ledger = Ledger()
    yield


# ---- packs -------------------------------------------------------------
def test_iap_packs_listed():
    r = client.get("/v1/iap/packs?storefront=IN")
    assert r.status_code == 200
    skus = {p["sku"] for p in r.json()}
    assert "coins_popular_in" in skus


# ---- iap verify guards -------------------------------------------------
def test_iap_verify_unknown_sku_is_400():
    r = client.post("/v1/iap/verify", headers=AUTH, json={"jws": "x", "sku": "nope"})
    assert r.status_code == 400


def test_iap_verify_missing_jws_is_400():
    r = client.post("/v1/iap/verify", headers=AUTH, json={"jws": "", "sku": "coins_popular_in"})
    assert r.status_code == 400


# ---- web order guard ---------------------------------------------------
def test_web_order_unknown_sku_is_400():
    r = client.post("/v1/web/orders", headers=AUTH, json={"sku": "nope"})
    assert r.status_code == 400


# ---- unlock guards -----------------------------------------------------
def test_unlock_bad_episode_number_is_404():
    r = client.post("/v1/series/kaanch-ka-mahal/episodes/99999/unlock", headers=AUTH,
                    json={"idempotency_key": "k"})
    assert r.status_code == 404


def test_unlock_unknown_series_is_404():
    r = client.post("/v1/series/does-not-exist/episodes/11/unlock", headers=AUTH,
                    json={"idempotency_key": "k"})
    assert r.status_code == 404


def test_unlock_all_unknown_series_is_404():
    r = client.post("/v1/series/does-not-exist/unlock-all", headers=AUTH,
                    json={"idempotency_key": "k"})
    assert r.status_code == 404


def test_unlock_all_insufficient_is_402():
    r = client.post("/v1/series/kaanch-ka-mahal/unlock-all", headers=AUTH,
                    json={"idempotency_key": "k"})
    assert r.status_code == 402


def test_unlock_all_succeeds_with_bundle_discount():
    # Fund enough for the whole bundle, then buy it.
    client.post("/v1/web/orders", headers=AUTH, json={"sku": "coins_mega_in"})  # 16000+1600
    r = client.post("/v1/series/kaanch-ka-mahal/unlock-all", headers=AUTH,
                    json={"idempotency_key": "bundle"})
    assert r.status_code == 200
    body = r.json()
    # 50 locked * 30 * 0.75 = 1125 spent; bonus (1600) drained first.
    assert body["spent_bonus"] == 1125
    assert body["wallet"]["total"] == 16000 + 1600 - 1125


# ---- catalog + playback guards ----------------------------------------
def test_series_detail_unknown_is_404():
    assert client.get("/v1/series/does-not-exist").status_code == 404


def test_playback_unknown_series_is_404():
    r = client.post("/v1/series/does-not-exist/episodes/1/playback", headers=AUTH)
    assert r.status_code == 404


def test_playback_bad_episode_number_is_404():
    r = client.post("/v1/series/kaanch-ka-mahal/episodes/0/playback", headers=AUTH)
    assert r.status_code == 404

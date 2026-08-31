"""End-to-end API tests for the core-api money loop, against the real seed catalog."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.store import store
from katha_ledger import Ledger

client = TestClient(app)
AUTH = {"Authorization": "Bearer test-user-1"}


@pytest.fixture(autouse=True)
def reset_ledger():
    # Each test gets a clean money state.
    store.ledger = Ledger()
    yield


def test_health_and_catalog_load():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["series"] == 6            # the 6 crawled series


def test_home_and_series_detail():
    assert client.get("/v1/home").status_code == 200
    r = client.get("/v1/series/his-one-and-only-love")
    assert r.status_code == 200
    body = r.json()
    assert body["episode_count"] == 81
    assert body["free_episode_count"] == 10
    assert len(body["episodes"]) == 81


def test_free_episode_plays_without_coins():
    r = client.post("/v1/series/deny-me-dragon-king/episodes/1/playback", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["locked"] is False
    assert body["hls_master_url"].endswith("master.m3u8?exp=2026-09-14T14:03:22+05:30")


def test_locked_episode_returns_price_and_bundle_offer():
    r = client.post("/v1/series/deny-me-dragon-king/episodes/11/playback", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["locked"] is True
    assert body["price_coins"] == 30
    assert body["balance"] == 0
    # 40 locked episodes * 30 * 0.75 = 900
    assert body["bundle_offer_coins"] == 900


def test_full_purchase_then_unlock_then_play():
    slug = "deny-me-dragon-king"
    # 1. locked before buying
    assert client.post(f"/v1/series/{slug}/episodes/11/playback", headers=AUTH).json()["locked"]
    # 2. buy the popular pack via IAP
    r = client.post("/v1/iap/verify", headers=AUTH,
                    json={"jws": "fake-signed-txn", "sku": "coins_popular_in"})
    assert r.json()["total"] == 1300
    # 3. unlock E11
    r = client.post(f"/v1/series/{slug}/episodes/11/unlock", headers=AUTH,
                    json={"idempotency_key": "unlock:test:1"})
    assert r.status_code == 200
    assert r.json()["wallet"]["total"] == 1270      # 1300 - 30
    # 4. now it plays
    play = client.post(f"/v1/series/{slug}/episodes/11/playback", headers=AUTH)
    assert play.json()["locked"] is False


def test_unlock_is_idempotent_over_http():
    slug = "deny-me-dragon-king"
    client.post("/v1/iap/verify", headers=AUTH, json={"jws": "j", "sku": "coins_popular_in"})
    body = {"idempotency_key": "same-key"}
    client.post(f"/v1/series/{slug}/episodes/11/unlock", headers=AUTH, json=body)
    client.post(f"/v1/series/{slug}/episodes/11/unlock", headers=AUTH, json=body)
    assert client.get("/v1/wallet", headers=AUTH).json()["total"] == 1270  # charged once


def test_unlock_without_coins_is_402():
    r = client.post("/v1/series/deny-me-dragon-king/episodes/11/unlock", headers=AUTH,
                    json={"idempotency_key": "k"})
    assert r.status_code == 402


def test_web_order_adds_ten_percent_bonus():
    r = client.post("/v1/web/orders", headers=AUTH, json={"sku": "coins_web_popular_in"})
    assert r.status_code == 200
    body = r.json()
    assert body["balance_bought"] == 1300
    assert body["balance_bonus"] == 130       # +10% web bonus
    assert body["total"] == 1430


def test_bundle_unlock_all_uses_discount_and_bonus_first():
    slug = "deny-me-dragon-king"
    client.post("/v1/web/orders", headers=AUTH, json={"sku": "coins_web_popular_in"})  # 1300+130
    r = client.post(f"/v1/series/{slug}/unlock-all", headers=AUTH,
                    json={"idempotency_key": "bundle:test"})
    assert r.status_code == 200
    body = r.json()
    assert len(body["episode_ids"]) == 40          # 50 total - 10 free... 50 eps, 10 free => 40 locked
    assert body["spent_bonus"] == 130              # bonus drained first
    assert body["wallet"]["balance_bonus"] == 0


def test_config_exposes_pricing_and_flags():
    c = client.get("/v1/config").json()
    assert c["free_episode_count"] == 10
    assert c["episode_coin_price"] == 30
    assert c["flags"]["store.web_enabled"] is True

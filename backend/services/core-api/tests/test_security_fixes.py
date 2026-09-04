"""Regression tests for the security review fixes: stream-token scope escape,
case-insensitive video gate, the dev-only bearer fallback, the dev-only IAP
stub, and the admin auth-mode default."""
import pytest
from fastapi.testclient import TestClient

from app import signing
from app.main import app
from app.store import store
from katha_ledger import Ledger

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_ledger():
    store.ledger = Ledger()
    yield


# --- stream-token scope (one episode's token must not walk the media tree) ---

def test_token_traversal_cannot_escape_prefix():
    token = signing.make_token("slug/e001/hls/", "u1")
    assert signing.check_token(token, "slug/e001/hls/master.m3u8")
    # The percent-encoded form of this arrives decoded from route matching.
    assert not signing.check_token(token, "slug/e001/hls/../../e011/hls/master.m3u8")
    assert not signing.check_token(token, "../secrets.txt")
    # Redundant-but-inside traversal stays allowed after normalization.
    assert signing.check_token(token, "slug/e001/hls/../hls/seg_000.ts")


def test_token_prefix_needs_segment_boundary():
    token = signing.make_token("slug/e001/hls", "u1")  # no trailing slash
    assert signing.check_token(token, "slug/e001/hls/master.m3u8")
    assert not signing.check_token(token, "slug/e001/hls-evil/master.m3u8")


def test_tokened_route_rejects_traversal_end_to_end(monkeypatch, tmp_path):
    base = tmp_path / "media"
    (base / "slug" / "e001" / "hls").mkdir(parents=True)
    (base / "slug" / "e011" / "hls").mkdir(parents=True)
    (base / "slug" / "e011" / "hls" / "master.m3u8").write_text("#EXTM3U")
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(base))
    token = signing.make_token("slug/e001/hls/", "u1")
    r = client.get(f"/media/t/{token}/slug/e001/hls/..%2F..%2Fe011%2Fhls%2Fmaster.m3u8")
    assert r.status_code == 403


# --- video gate is case-insensitive (APFS finds files case-insensitively) ---

def test_is_video_matches_any_case():
    assert signing.is_video("slug/e011/HLS/master.M3U8")
    assert signing.is_video("slug/e011/hls/seg_000.TS")
    assert signing.is_video("slug/e011/SOURCE.MP4")
    assert not signing.is_video("slug/cover_9x16.jpg")


def test_public_route_blocks_uppercase_video(monkeypatch, tmp_path):
    base = tmp_path / "media"
    (base / "slug" / "e011" / "hls").mkdir(parents=True)
    (base / "slug" / "e011" / "hls" / "master.m3u8").write_text("#EXTM3U")
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(base))
    assert client.get("/media/slug/e011/HLS/master.M3U8").status_code == 403


# --- dev stubs are OFF once a real deployment opts out ---

def test_raw_bearer_rejected_outside_dev(monkeypatch):
    monkeypatch.setenv("KATHA_DEV_STUBS", "0")
    r = client.get("/v1/wallet", headers={"Authorization": "Bearer usr_deadbeef00000000"})
    assert r.status_code == 401


def test_signed_jwt_still_works_outside_dev(monkeypatch):
    from app.auth import issue_token
    monkeypatch.setenv("KATHA_DEV_STUBS", "0")
    tok = issue_token("usr_deadbeef00000000")
    r = client.get("/v1/wallet", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200


def test_iap_stub_refuses_outside_dev(monkeypatch):
    from app.auth import issue_token
    monkeypatch.setenv("KATHA_DEV_STUBS", "0")
    tok = issue_token("usr_deadbeef00000000")
    r = client.post("/v1/iap/verify", headers={"Authorization": f"Bearer {tok}"},
                    json={"jws": "anything", "sku": "coins_popular_in"})
    assert r.status_code == 501


def test_web_order_stub_refuses_outside_dev(monkeypatch):
    """C1: the web-order stub credits coins on the caller's word alone, so it
    must fail closed exactly like the IAP stub once dev stubs are off."""
    from app.auth import issue_token
    from app.store import store
    monkeypatch.setenv("KATHA_DEV_STUBS", "0")
    user = "usr_deadbeef00000001"
    tok = issue_token(user)
    before = store.ledger.balance(user).total
    r = client.post("/v1/web/orders", headers={"Authorization": f"Bearer {tok}"},
                    json={"sku": "coins_mega_in", "order_ref": "pay_forged_1"})
    assert r.status_code == 501
    assert store.ledger.balance(user).total == before


def test_iap_idempotency_key_is_user_bound():
    a = {"Authorization": "Bearer iap-user-a"}
    b = {"Authorization": "Bearer iap-user-b"}
    body = {"jws": "same-receipt", "sku": "coins_popular_in"}
    balance_a = client.post("/v1/iap/verify", headers=a, json=body).json()["total"]
    balance_b = client.post("/v1/iap/verify", headers=b, json=body).json()["total"]
    # Each user's credit stands on its own; B never dedupes against A.
    assert balance_a > 0 and balance_b == balance_a


# --- admin auth fails closed by default ---

def test_admin_auth_mode_defaults_to_oidc(monkeypatch):
    from admin_app import oidc
    monkeypatch.delenv("KATHA_ADMIN_AUTH", raising=False)
    assert oidc.auth_mode() == "oidc"

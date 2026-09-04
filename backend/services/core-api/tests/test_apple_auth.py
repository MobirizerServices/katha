"""B3: outside dev stubs, /v1/auth/apple verifies the identity token against
Apple's JWKS and identifies the user by `sub`, not by the token string."""
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app import apple
from app.main import app

client = TestClient(app)
KID = "test-kid"
_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _FakeSigningKey:
    key = _key.public_key()


class _FakeJWKS:
    def get_signing_key_from_jwt(self, token):
        if jwt.get_unverified_header(token).get("kid") != KID:
            raise ValueError("unknown kid")
        return _FakeSigningKey()


def _apple_token(**over) -> str:
    claims = {"iss": apple.APPLE_ISSUER, "aud": "dev.katha.app", "sub": "001234.abcdef",
              "iat": int(time.time()), "exp": int(time.time()) + 300}
    claims.update(over)
    return jwt.encode(claims, _key, algorithm="RS256", headers={"kid": KID})


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setenv("KATHA_DEV_STUBS", "0")
    monkeypatch.setenv("KATHA_APPLE_BUNDLE_ID", "dev.katha.app")
    monkeypatch.setattr(apple, "_client", lambda: _FakeJWKS())


def test_valid_token_logs_in_by_sub_across_fresh_tokens():
    first = client.post("/v1/auth/apple", json={"identity_token": _apple_token()})
    second = client.post("/v1/auth/apple", json={"identity_token": _apple_token(iat=1)})
    assert first.status_code == second.status_code == 200
    assert first.json()["user"]["user_id"] == second.json()["user"]["user_id"]
    assert first.json()["user"]["kind"] == "apple"


@pytest.mark.parametrize("bad", [
    dict(aud="someone.else"),
    dict(iss="https://accounts.example.com"),
    dict(exp=int(time.time()) - 10),
    dict(sub=""),
])
def test_bad_claims_are_401(bad):
    r = client.post("/v1/auth/apple", json={"identity_token": _apple_token(**bad)})
    assert r.status_code == 401


def test_stub_and_garbage_tokens_are_401_outside_dev():
    assert client.post("/v1/auth/apple",
                       json={"identity_token": "dev-apple-token"}).status_code == 401
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged = jwt.encode({"iss": apple.APPLE_ISSUER, "aud": "dev.katha.app", "sub": "x",
                         "exp": int(time.time()) + 60}, other_key, algorithm="RS256",
                        headers={"kid": KID})
    assert client.post("/v1/auth/apple", json={"identity_token": forged}).status_code == 401


def test_unconfigured_audience_refuses(monkeypatch):
    monkeypatch.delenv("KATHA_APPLE_BUNDLE_ID")
    r = client.post("/v1/auth/apple", json={"identity_token": _apple_token()})
    assert r.status_code == 401 and "KATHA_APPLE_BUNDLE_ID" in r.json()["detail"]


def test_jwks_client_is_built_once(monkeypatch):
    import importlib
    fresh = importlib.reload(apple)
    monkeypatch.setattr(fresh, "_jwks_client", None)
    a = fresh._client()
    assert a is fresh._client()
    assert a.uri == fresh.APPLE_JWKS_URL

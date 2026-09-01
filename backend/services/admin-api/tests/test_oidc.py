"""OIDC sign-in (#074/#075): the full code+PKCE flow against the built-in dev
IdP, session cookies, per-request role resolution, CSRF, the provisioning
directory, and the real-issuer discovery/JWKS/token-exchange paths (mocked)."""
import json
import time
import urllib.parse

import jwt as pyjwt
import pytest
from fastapi.testclient import TestClient

from admin_app import oidc
from admin_app.main import app
from admin_app.store import store
from katha_ledger import Ledger

ADMIN = {"X-Actor-Id": "riya", "X-Role": "admin"}
CB = "http://testserver/admin/v1/auth/callback"


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    store.ledger = Ledger()
    store.audit.clear()
    store.approvals.clear()
    store.known_users.clear()
    store.flag_overrides.clear()
    store.admin_users.clear()
    oidc._DEV_CODES.clear()
    oidc._DISCOVERY.clear()
    oidc._JWKS.clear()
    oidc._JWKS_FETCHED_AT["t"] = 0.0
    monkeypatch.setenv("KATHA_OIDC_REDIRECT_URL", CB)
    yield


@pytest.fixture
def oidc_mode(monkeypatch):
    monkeypatch.setenv("KATHA_ADMIN_AUTH", "oidc")
    yield


def sign_in(client: TestClient, email: str) -> str:
    """Drive the whole browser flow; returns the final redirect location."""
    r = client.get("/admin/v1/auth/login", follow_redirects=False)
    assert r.status_code == 302
    authorize = r.headers["location"]
    assert "code_challenge=" in authorize and "state=" in authorize
    page = client.get(authorize)
    assert page.status_code == 200 and "dev identity provider" in page.text
    r = client.post(authorize, data={"email": email}, follow_redirects=False)
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith(CB)
    r = client.get(loc.removeprefix("http://testserver"), follow_redirects=False)
    assert r.status_code == 302
    return r.headers["location"]


# --- the happy path ---------------------------------------------------------

def test_full_flow_provisioned_admin(oidc_mode):
    client = TestClient(app)
    assert sign_in(client, "ops@katha.dev") == "/"
    me = client.get("/admin/v1/auth/me").json()
    assert me["authenticated"] is True
    assert me["email"] == "ops@katha.dev" and me["role"] == "admin"
    assert me["mode"] == "oidc" and me["devIdp"] is True
    # a guarded endpoint works with the cookie alone — no headers anywhere
    assert client.get("/admin/v1/overview").status_code == 200
    # the login is audited with the resolved role
    kinds = [(a.action, a.actor_id) for a in store.audit]
    assert ("auth.login", "ops@katha.dev") in kinds


def test_headers_are_ignored_in_oidc_mode(oidc_mode):
    client = TestClient(app)
    r = client.get("/admin/v1/overview", headers=ADMIN)
    assert r.status_code == 401
    assert r.headers.get("x-katha-login") == "/admin/v1/auth/login"
    assert client.get("/admin/v1/auth/me").json()["authenticated"] is False


def test_csrf_required_for_cookie_mutations(oidc_mode):
    client = TestClient(app)
    sign_in(client, "ops@katha.dev")
    body = {"user_id": "u1", "coins": 40, "reason_code": "goodwill"}
    r = client.post("/admin/v1/wallet/adjust", json=body)
    assert r.status_code == 403 and "CSRF" in r.json()["detail"]
    r = client.post("/admin/v1/wallet/adjust", json=body,
                    headers={"X-Katha-CSRF": "1"})
    assert r.status_code == 200


def test_logout_clears_the_session(oidc_mode):
    client = TestClient(app)
    sign_in(client, "ops@katha.dev")
    assert client.post("/admin/v1/auth/logout").json() == {"ok": True}
    assert client.get("/admin/v1/auth/me").json()["authenticated"] is False
    assert client.get("/admin/v1/overview").status_code == 401
    assert any(a.action == "auth.logout" for a in store.audit)


def test_revocation_is_instant_mid_session(oidc_mode):
    client = TestClient(app)
    sign_in(client, "ops@katha.dev")
    assert client.get("/admin/v1/overview").status_code == 200
    oidc.directory_delete("ops@katha.dev")
    store.admin_users["keep@katha.dev"] = {"role": "admin"}  # not empty → no reseed
    r = client.get("/admin/v1/overview")
    assert r.status_code == 401 and "revoked" in r.json()["detail"]
    me = client.get("/admin/v1/auth/me").json()
    assert me["authenticated"] is False and me["reason"] == "not_provisioned"


# --- flow attacks -----------------------------------------------------------

def test_unprovisioned_email_is_turned_away_and_audited(oidc_mode):
    client = TestClient(app)
    assert sign_in(client, "stranger@example.com") == "/"
    note = urllib.parse.unquote(client.cookies.get(oidc.NOTE_COOKIE) or "")
    assert note == "not_provisioned:stranger@example.com"
    assert client.get("/admin/v1/auth/me").json()["authenticated"] is False
    assert any(a.action == "auth.denied" for a in store.audit)


def test_state_mismatch_is_rejected(oidc_mode):
    client = TestClient(app)
    r = client.get("/admin/v1/auth/login", follow_redirects=False)
    authorize = r.headers["location"]
    r = client.post(authorize, data={"email": "ops@katha.dev"},
                    follow_redirects=False)
    code = urllib.parse.parse_qs(urllib.parse.urlparse(r.headers["location"]).query)["code"][0]
    r = client.get(f"/admin/v1/auth/callback?code={code}&state=EVIL",
                   follow_redirects=False)
    assert r.headers["location"] == "/"
    assert "state" in urllib.parse.unquote(client.cookies.get(oidc.NOTE_COOKIE))


def test_callback_without_flow_cookie_fails(oidc_mode):
    client = TestClient(app)
    r = client.get("/admin/v1/auth/callback?code=x&state=y", follow_redirects=False)
    assert "expired" in urllib.parse.unquote(client.cookies.get(oidc.NOTE_COOKIE))


def test_idp_error_param_short_circuits(oidc_mode):
    client = TestClient(app)
    r = client.get("/admin/v1/auth/callback?error=access_denied",
                   follow_redirects=False)
    assert "access_denied" in urllib.parse.unquote(client.cookies.get(oidc.NOTE_COOKIE))


def test_code_single_use_and_pkce(oidc_mode):
    client = TestClient(app)
    sign_in(client, "ops@katha.dev")
    with pytest.raises(oidc.AuthFlowError):
        oidc._dev_redeem("no-such-code", "v")
    oidc._DEV_CODES["c1"] = {"email": "x@x", "nonce": "n",
                             "challenge": "wrong", "exp": time.time() + 60}
    with pytest.raises(oidc.AuthFlowError, match="PKCE"):
        oidc._dev_redeem("c1", "some-verifier")


def test_tampered_session_cookie_is_signed_out(oidc_mode):
    client = TestClient(app)
    client.cookies.set(oidc.SESSION_COOKIE, "garbage.sig")
    assert client.get("/admin/v1/auth/me").json()["authenticated"] is False
    assert client.get("/admin/v1/overview").status_code == 401
    # a forged-but-unsigned payload fails the HMAC too
    body = oidc._b64(json.dumps({"email": "ops@katha.dev",
                                 "exp": time.time() + 999}).encode())
    client.cookies.set(oidc.SESSION_COOKIE, f"{body}.forged")
    assert client.get("/admin/v1/overview").status_code == 401


def test_expired_payloads_read_as_none():
    token = oidc.sign_payload({"email": "x@x", "exp": time.time() - 1})
    assert oidc.read_payload(token) is None
    assert oidc.read_payload(None) is None
    assert oidc.read_payload("no-dot") is None


# --- ID-token verification (shared by dev IdP and Google) -------------------

def test_nonce_mismatch_rejected(oidc_mode):
    token = oidc._dev_mint_id_token("ops@katha.dev", nonce="expected")
    with pytest.raises(oidc.AuthFlowError, match="nonce"):
        oidc.verify_id_token(token, "different")
    assert oidc.verify_id_token(token, "expected")["email"] == "ops@katha.dev"


def test_signature_tamper_rejected(oidc_mode):
    token = oidc._dev_mint_id_token("ops@katha.dev", nonce="n")
    head, body, sig = token.split(".")
    forged = f"{head}.{body}.{'A' * len(sig)}"
    with pytest.raises(oidc.AuthFlowError, match="rejected"):
        oidc.verify_id_token(forged, "n")


def test_hd_claim_enforced_when_configured(oidc_mode, monkeypatch):
    monkeypatch.setenv("KATHA_OIDC_HD", "katha.dev")
    token = oidc._dev_mint_id_token("ops@katha.dev", nonce="n")  # no hd claim
    with pytest.raises(oidc.AuthFlowError, match="workspace"):
        oidc.verify_id_token(token, "n")


def test_unverified_email_rejected(oidc_mode):
    keys = oidc._dev_keys()
    now = int(time.time())
    token = pyjwt.encode(
        {"iss": oidc.DEV_ISSUER, "aud": oidc._client_id(), "nonce": "n",
         "email": "x@x.dev", "email_verified": False, "iat": now, "exp": now + 60},
        keys["private"], algorithm="RS256")
    with pytest.raises(oidc.AuthFlowError, match="verified email"):
        oidc.verify_id_token(token, "n")


# --- the real-issuer path, with the network mocked --------------------------

def test_real_issuer_discovery_jwks_and_exchange(oidc_mode, monkeypatch):
    issuer = "https://accounts.example.com"
    monkeypatch.setenv("KATHA_OIDC_ISSUER", issuer)
    monkeypatch.setenv("KATHA_OIDC_CLIENT_ID", "real-client")
    keys = oidc._dev_keys()
    now = int(time.time())
    id_token = pyjwt.encode(
        {"iss": issuer, "aud": "real-client", "nonce": "n", "email": "g@x.dev",
         "email_verified": True, "iat": now, "exp": now + 60},
        keys["private"], algorithm="RS256", headers={"kid": keys["kid"]})
    jwk = json.loads(pyjwt.algorithms.RSAAlgorithm.to_jwk(keys["public"]))
    jwk["kid"] = keys["kid"]

    def fake_http(url, data=None):
        if "well-known" in url:
            return {"authorization_endpoint": f"{issuer}/auth",
                    "token_endpoint": f"{issuer}/token",
                    "jwks_uri": f"{issuer}/jwks"}
        if url.endswith("/jwks"):
            return {"keys": [jwk]}
        if url.endswith("/token"):
            assert b"code_verifier" in data and b"grant_type" in data
            return {"id_token": id_token}
        raise AssertionError(url)

    monkeypatch.setattr(oidc, "_http_json", fake_http)
    assert oidc._exchange_code("any-code", "verifier") == id_token
    assert oidc.verify_id_token(id_token, "n")["email"] == "g@x.dev"
    # the authorize URL now points at the real issuer
    assert oidc._authorize_url("s", "n", "c").startswith(f"{issuer}/auth?")
    # unknown kid → refused (cache refetch window respected)
    with pytest.raises(oidc.AuthFlowError, match="unknown signing key"):
        oidc._jwks_key(issuer, "other-kid")


def test_real_issuer_token_failures(oidc_mode, monkeypatch):
    issuer = "https://accounts.example.com"
    monkeypatch.setenv("KATHA_OIDC_ISSUER", issuer)

    def no_id_token(url, data=None):
        if "well-known" in url:
            return {"token_endpoint": f"{issuer}/token", "jwks_uri": "x",
                    "authorization_endpoint": "y"}
        return {"access_token": "only"}

    monkeypatch.setattr(oidc, "_http_json", no_id_token)
    with pytest.raises(oidc.AuthFlowError, match="no id_token"):
        oidc._exchange_code("c", "v")

    def boom(url, data=None):
        if "well-known" in url:
            return {"token_endpoint": f"{issuer}/token", "jwks_uri": "x",
                    "authorization_endpoint": "y"}
        raise OSError("connection refused")

    oidc._DISCOVERY.clear()
    monkeypatch.setattr(oidc, "_http_json", boom)
    with pytest.raises(oidc.AuthFlowError, match="exchange failed"):
        oidc._exchange_code("c", "v")


# --- dev IdP guardrails -----------------------------------------------------

def test_devidp_hidden_outside_oidc_dev(monkeypatch):
    client = TestClient(app)
    assert client.get("/admin/v1/devidp/authorize").status_code == 404
    monkeypatch.setenv("KATHA_ADMIN_AUTH", "oidc")
    monkeypatch.setenv("KATHA_OIDC_ISSUER", "https://real")
    assert client.get("/admin/v1/devidp/authorize").status_code == 404
    assert client.post("/admin/v1/devidp/authorize",
                       data={"email": "x@x"}).status_code == 404


def test_devidp_rejects_foreign_redirect_uri(oidc_mode):
    client = TestClient(app)
    r = client.post("/admin/v1/devidp/authorize?redirect_uri=https://evil.example",
                    data={"email": "ops@katha.dev"})
    assert r.status_code == 400


# --- the provisioning directory --------------------------------------------

def test_env_bootstrap_seeding(monkeypatch):
    monkeypatch.setenv("KATHA_ADMIN_USERS",
                       "a@katha.dev:admin, b@katha.dev:support, junk, c@x:badrole")
    rows = oidc.directory_all()
    assert set(rows) == {"a@katha.dev", "b@katha.dev"}
    assert oidc.directory_role("A@katha.dev") == "admin"
    assert oidc.directory_role("c@x") is None


def test_access_endpoints_crud_and_guards():
    client = TestClient(app)
    # provisioning is admin-only
    assert client.get("/admin/v1/access/users",
                      headers={"X-Actor-Id": "s", "X-Role": "support"}).status_code == 403
    r = client.put("/admin/v1/access/users/riya@katha.dev", headers=ADMIN,
                   json={"role": "support"})
    assert r.status_code == 200
    listed = client.get("/admin/v1/access/users", headers=ADMIN).json()["users"]
    assert {"email": "riya@katha.dev"}.items() <= listed[-1].items() or any(
        u["email"] == "riya@katha.dev" and u["role"] == "support" for u in listed)
    # unknown role
    assert client.put("/admin/v1/access/users/x@katha.dev", headers=ADMIN,
                      json={"role": "boss"}).status_code == 400
    # granting admin needs the typed confirmation
    r = client.put("/admin/v1/access/users/dev2@katha.dev", headers=ADMIN,
                   json={"role": "admin"})
    assert r.status_code == 428
    r = client.put("/admin/v1/access/users/dev2@katha.dev", headers=ADMIN,
                   json={"role": "admin", "confirm": "dev2@katha.dev"})
    assert r.status_code == 200
    # you can't touch your own entry
    assert client.put("/admin/v1/access/users/riya", headers=ADMIN,
                      json={"role": "support"}).status_code == 409
    assert client.delete("/admin/v1/access/users/riya", headers=ADMIN).status_code == 409
    # last-admin guard: drop dev2, then the bootstrap admin cannot be removed
    assert client.delete("/admin/v1/access/users/dev2@katha.dev",
                         headers=ADMIN).status_code == 200
    only_admin = [e for e, v in oidc.directory_all().items() if v["role"] == "admin"]
    r = client.delete(f"/admin/v1/access/users/{only_admin[0]}", headers=ADMIN)
    assert r.status_code == 409 and "last admin" in r.json()["detail"]
    # revoking someone never provisioned
    assert client.delete("/admin/v1/access/users/ghost@katha.dev",
                         headers=ADMIN).status_code == 404
    # every change is audited
    actions = [a.action for a in store.audit]
    assert "access.grant" in actions and "access.revoke" in actions


def test_role_matrix_enforced_for_oidc_operators(oidc_mode):
    store.admin_users["riya@katha.dev"] = {"role": "support", "by": "t", "at": "t"}
    client = TestClient(app)
    sign_in(client, "riya@katha.dev")
    assert client.get("/admin/v1/grievances").status_code == 200
    # support cannot flip flags (content/admin capability)
    r = client.patch("/admin/v1/config/flags/store.web_enabled",
                     json={"enabled": False}, headers={"X-Katha-CSRF": "1"})
    assert r.status_code == 403


def test_auth_me_in_headers_mode_echoes_headers():
    client = TestClient(app)
    me = client.get("/admin/v1/auth/me", headers=ADMIN).json()
    assert me == {"mode": "headers", "authenticated": True,
                  "email": "riya", "role": "admin"}
    assert client.get("/admin/v1/auth/me").json()["authenticated"] is False


def test_step_up_blocks_stale_sessions_from_money(oidc_mode):
    """#079: a session older than 15 min cannot approve/refund — re-auth first."""
    client = TestClient(app)
    sign_in(client, "ops@katha.dev")
    # queue an approval with the FRESH session
    r = client.post("/admin/v1/wallet/adjust", headers={"X-Katha-CSRF": "1"},
                    json={"user_id": "su-u", "coins": 900, "reason_code": "goodwill"})
    ap_id = r.json()["approval"]["id"]
    # a second admin with an OLD session tries to approve
    store.admin_users["lead@katha.dev"] = {"role": "admin"}
    old = oidc.sign_payload({"email": "lead@katha.dev", "sid": "x",
                             "iat": time.time() - 3600,
                             "exp": time.time() + 3600})
    client.cookies.set(oidc.SESSION_COOKIE, old)
    r = client.post(f"/admin/v1/approvals/{ap_id}/approve",
                    headers={"X-Katha-CSRF": "1"})
    assert r.status_code == 403 and "step-up" in r.json()["detail"]
    # fresh sign-in → allowed
    client.cookies.delete(oidc.SESSION_COOKIE)
    sign_in(client, "lead@katha.dev")
    r = client.post(f"/admin/v1/approvals/{ap_id}/approve",
                    headers={"X-Katha-CSRF": "1"})
    assert r.status_code == 200
    # sign-out-everywhere is money-adjacent: stale session also refused
    client.cookies.set(oidc.SESSION_COOKIE, old)
    r = client.post("/admin/v1/users/su-u/signout-devices",
                    headers={"X-Katha-CSRF": "1"})
    assert r.status_code == 403


def test_auth_me_reports_session_age(oidc_mode):
    client = TestClient(app)
    sign_in(client, "ops@katha.dev")
    me = client.get("/admin/v1/auth/me").json()
    assert me["since"] > 0 and time.time() - me["since"] < 60


def test_callback_with_burned_code_walks_the_error_path(oidc_mode):
    """A code that fails redemption (already used / forged) sends the operator
    back to the gate with the reason in the notice cookie."""
    client = TestClient(app)
    r = client.get("/admin/v1/auth/login", follow_redirects=False)
    authorize = r.headers["location"]
    state = urllib.parse.parse_qs(urllib.parse.urlparse(authorize).query)["state"][0]
    r = client.get(f"/admin/v1/auth/callback?code=forged-code&state={state}",
                   follow_redirects=False)
    assert r.headers["location"] == "/"
    note = urllib.parse.unquote(client.cookies.get(oidc.NOTE_COOKIE))
    assert note.startswith("error:") and "expired or already used" in note
    assert client.get("/admin/v1/auth/me").json()["authenticated"] is False

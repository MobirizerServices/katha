"""OIDC sign-in for the back office (review #074/#075).

Authorization Code + PKCE relying party. Identity comes from a cryptographically
verified ID token; the operator's ROLE never comes from the client — it is
resolved on every request from the server-side directory (`adminuser:{email}`
in the shared KV, or the in-memory store without persistence), so revocation is
instant.

Two auth modes, chosen by `KATHA_ADMIN_AUTH`:
- "oidc" (default): headers are ignored. Sessions only.
- "headers": the historical dev/test path — X-Actor-Id/X-Role headers, i.e.
  the caller names its own role. EXPLICIT opt-in only, never a default: an
  env-less deploy must fail closed, not hand full admin to any network caller.

Two identity providers, chosen by `KATHA_OIDC_ISSUER`:
- unset: a built-in DEV IdP (this module) — full authorize→code→ID-token flow
  with a real RS256 signature, so the verification path is byte-identical to
  production. Dev only: the code redeem is in-process (no self-HTTP).
- set (e.g. https://accounts.google.com): standard discovery, token exchange,
  and JWKS verification. `KATHA_OIDC_CLIENT_ID` / `KATHA_OIDC_CLIENT_SECRET`
  come from the Google Cloud console.

Sessions are stateless signed cookies (HMAC-SHA256, HttpOnly, SameSite=Lax,
12h). In-flight flow state (state/nonce/PKCE verifier) lives in a short-lived
signed cookie too, so multi-instance deployments need no shared session store.
Cookie-authenticated mutations must carry `X-Katha-CSRF: 1` — combined with
strict CORS and SameSite=Lax this blocks cross-site request forgery.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.parse
import urllib.request

import jwt as pyjwt
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.responses import JSONResponse

from katha_domain.timeutil import now_iso

from .rbac import Role, require
from .store import store

SESSION_COOKIE = "katha_admin_session"
NOTE_COOKIE = "katha_admin_auth_note"  # readable by the SPA, 60s, no HttpOnly
FLOW_COOKIE = "katha_admin_oidc"
SESSION_TTL_S = int(os.environ.get("KATHA_ADMIN_SESSION_TTL_H", "12")) * 3600
FLOW_TTL_S = 600
DEV_ISSUER = "katha-dev-idp"

_SESSION_SECRET = (os.environ.get("KATHA_ADMIN_SESSION_SECRET")
                   or secrets.token_hex(32)).encode()


def auth_mode() -> str:
    """'headers' (client-named roles, dev/test only) needs the literal opt-in;
    ANY other value — including a typo like "oidc-google" — is OIDC. Falling
    through to header identity on an unrecognised value would fall open."""
    raw = os.environ.get("KATHA_ADMIN_AUTH", "oidc").strip().lower()
    return "headers" if raw == "headers" else "oidc"


def internal_idp() -> bool:
    """The built-in dev IdP stands in only when no issuer is configured AND
    this is not a managed environment: its sign-in page is one click to any
    directory role, so it must never be reachable from QA/prod even if the
    issuer variable is accidentally blank (prodguard refuses that boot too)."""
    if os.environ.get("KATHA_OIDC_ISSUER"):
        return False
    from katha_infra.prodguard import is_managed_env
    return not is_managed_env()


def _client_id() -> str:
    return os.environ.get("KATHA_OIDC_CLIENT_ID", "katha-admin-dev")


def _redirect_url() -> str:
    return os.environ.get("KATHA_OIDC_REDIRECT_URL",
                          "http://localhost:5174/admin/v1/auth/callback")


def _cookie_secure() -> bool:
    return os.environ.get("KATHA_ADMIN_COOKIE_SECURE") == "1"


# --- signed compact tokens (sessions + flow state) --------------------------

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def sign_payload(payload: dict) -> str:
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64(hmac.new(_SESSION_SECRET, body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read_payload(token: str | None) -> dict | None:
    if not token or "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    want = _b64(hmac.new(_SESSION_SECRET, body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(want, sig):
        return None
    try:
        payload = json.loads(_unb64(body))
    except (ValueError, UnicodeDecodeError):
        return None
    if payload.get("exp", 0) < time.time():
        return None
    return payload


def session_identity(request: Request) -> dict | None:
    """The signed-in operator from the session cookie, or None."""
    return read_payload(request.cookies.get(SESSION_COOKIE))


# --- the role directory -----------------------------------------------------

def _shared():
    from . import main
    return main.SHARED


DIR_PREFIX = "adminuser:"


def _seed_env_users() -> dict[str, dict]:
    """`KATHA_ADMIN_USERS=a@x:admin,b@x:support` → bootstrap entries."""
    raw = os.environ.get("KATHA_ADMIN_USERS", "ops@katha.dev:admin")
    out: dict[str, dict] = {}
    for part in raw.split(","):
        if ":" not in part:
            continue
        email, role = part.rsplit(":", 1)
        email, role = email.strip().lower(), role.strip().lower()
        if email and role in {r.value for r in Role}:
            out[email] = {"role": role, "by": "bootstrap", "at": now_iso()}
    return out


def directory_all() -> dict[str, dict]:
    shared = _shared()
    if shared is not None:
        # kv_prefix strips the prefix — keys come back as bare emails
        rows = {k: json.loads(v)
                for k, v in shared.kv_prefix(DIR_PREFIX).items()}
    else:
        rows = dict(store.admin_users)
    if not rows:
        rows = _seed_env_users()
        for email, entry in rows.items():
            _directory_write(email, entry)
    return rows


def _directory_write(email: str, entry: dict) -> None:
    shared = _shared()
    if shared is not None:
        shared.kv_set(DIR_PREFIX + email, json.dumps(entry))
    else:
        store.admin_users[email] = entry


def directory_delete(email: str) -> None:
    shared = _shared()
    if shared is not None:
        shared.kv_set(DIR_PREFIX + email, json.dumps({"role": ""}))
    else:
        store.admin_users.pop(email, None)


def directory_role(email: str) -> str | None:
    """One keyed read per request (the old path scanned the whole KV table);
    the full-directory walk only runs to seed the bootstrap operators."""
    shared = _shared()
    entry = None
    if shared is not None:
        raw = shared.kv_get(f"{DIR_PREFIX}{email.lower()}")
        if raw:
            try:
                entry = json.loads(raw)
            except ValueError:
                entry = None
    if entry is None:
        entry = directory_all().get(email.lower())
    role = (entry or {}).get("role") or None
    return role if role in {r.value for r in Role} else None


# --- dev IdP: RS256 keys, authorize page, in-process code redeem ------------

_DEV_KEYS: dict = {}
_DEV_CODES: dict[str, dict] = {}


def _dev_keys() -> dict:
    if not _DEV_KEYS:
        from cryptography.hazmat.primitives.asymmetric import rsa
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        _DEV_KEYS.update(private=key, public=key.public_key(), kid="dev-1")
    return _DEV_KEYS


def _dev_mint_id_token(email: str, nonce: str) -> str:
    keys = _dev_keys()
    now = int(time.time())
    claims = {
        "iss": DEV_ISSUER, "aud": _client_id(),
        "sub": hashlib.sha256(email.encode()).hexdigest()[:20],
        "email": email, "email_verified": True,
        "name": email.split("@")[0].replace(".", " ").title(),
        "nonce": nonce, "iat": now, "exp": now + 300,
    }
    return pyjwt.encode(claims, keys["private"], algorithm="RS256",
                        headers={"kid": keys["kid"]})


def _dev_redeem(code: str, verifier: str) -> str:
    entry = _DEV_CODES.pop(code, None)
    if entry is None or entry["exp"] < time.time():
        raise AuthFlowError("code expired or already used")
    challenge = _b64(hashlib.sha256(verifier.encode()).digest())
    if not hmac.compare_digest(entry["challenge"], challenge):
        raise AuthFlowError("PKCE verifier mismatch")
    return _dev_mint_id_token(entry["email"], entry["nonce"])


class AuthFlowError(Exception):
    pass


# --- real issuer: discovery, token exchange, JWKS ---------------------------

_DISCOVERY: dict[str, dict] = {}
_JWKS: dict[str, object] = {}
_JWKS_FETCHED_AT = {"t": 0.0}


def _http_json(url: str, data: bytes | None = None) -> dict:
    req = urllib.request.Request(url, data=data, headers={
        "Accept": "application/json",
        **({"Content-Type": "application/x-www-form-urlencoded"} if data else {}),
    })
    with urllib.request.urlopen(req, timeout=5) as resp:  # noqa: S310 (https issuers)
        return json.loads(resp.read())


def _discovery(issuer: str) -> dict:
    if issuer not in _DISCOVERY:
        _DISCOVERY[issuer] = _http_json(
            issuer.rstrip("/") + "/.well-known/openid-configuration")
    return _DISCOVERY[issuer]


def _jwks_key(issuer: str, kid: str):
    if kid not in _JWKS and time.time() - _JWKS_FETCHED_AT["t"] > 30:
        _JWKS_FETCHED_AT["t"] = time.time()
        fresh = {}
        for k in _http_json(_discovery(issuer)["jwks_uri"]).get("keys", []):
            if k.get("kty") == "RSA":
                fresh[k["kid"]] = pyjwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(k))
        # Replace, don't merge: a key the IdP retired must stop verifying tokens.
        _JWKS.clear()
        _JWKS.update(fresh)
    if kid not in _JWKS:
        raise AuthFlowError(f"unknown signing key {kid}")
    return _JWKS[kid]


def _exchange_code(code: str, verifier: str) -> str:
    """code → ID token. In-process for the dev IdP, HTTPS for a real issuer."""
    if internal_idp():
        return _dev_redeem(code, verifier)
    issuer = os.environ["KATHA_OIDC_ISSUER"]
    form = urllib.parse.urlencode({
        "grant_type": "authorization_code", "code": code,
        "client_id": _client_id(),
        "client_secret": os.environ.get("KATHA_OIDC_CLIENT_SECRET", ""),
        "redirect_uri": _redirect_url(), "code_verifier": verifier,
    }).encode()
    try:
        token = _http_json(_discovery(issuer)["token_endpoint"], data=form)
    except Exception as exc:  # urllib errors vary; all mean "IdP unreachable"
        raise AuthFlowError(f"token exchange failed: {exc}") from exc
    if "id_token" not in token:
        raise AuthFlowError("token response had no id_token")
    return token["id_token"]


def verify_id_token(id_token: str, nonce: str) -> dict:
    """The security-critical step — identical for the dev IdP and Google."""
    if internal_idp():
        issuer, key = DEV_ISSUER, _dev_keys()["public"]
    else:
        issuer = os.environ["KATHA_OIDC_ISSUER"]
        key = _jwks_key(issuer, pyjwt.get_unverified_header(id_token).get("kid", ""))
    try:
        claims = pyjwt.decode(
            id_token, key=key, algorithms=["RS256"], audience=_client_id(),
            issuer=issuer, leeway=60,
            options={"require": ["exp", "iat", "aud", "iss"]},
        )
    except pyjwt.PyJWTError as exc:
        raise AuthFlowError(f"ID token rejected: {exc}") from exc
    if not hmac.compare_digest(claims.get("nonce", ""), nonce):
        raise AuthFlowError("nonce mismatch")
    if not claims.get("email") or not claims.get("email_verified"):
        raise AuthFlowError("no verified email in ID token")
    hd = os.environ.get("KATHA_OIDC_HD")
    if hd and claims.get("hd") != hd:
        raise AuthFlowError(f"account is outside the {hd} workspace")
    return claims


# --- HTTP: /auth/* + the dev IdP + the access directory ---------------------

router = APIRouter(prefix="/admin/v1")


def _authorize_url(state: str, nonce: str, challenge: str, *, step_up: bool = False) -> str:
    if internal_idp():
        base = "/admin/v1/devidp/authorize"
        endpoint = base
    else:
        endpoint = _discovery(os.environ["KATHA_OIDC_ISSUER"])["authorization_endpoint"]
    q = urllib.parse.urlencode({
        "response_type": "code", "client_id": _client_id(),
        "redirect_uri": _redirect_url(), "scope": "openid email profile",
        "state": state, "nonce": nonce,
        "code_challenge": challenge, "code_challenge_method": "S256",
        **({"hd": os.environ["KATHA_OIDC_HD"]}
           if os.environ.get("KATHA_OIDC_HD") else {}),
        # Step-up: the IdP must make the person authenticate again NOW, not
        # silently reuse its own SSO session (max_age=0 + prompt=login).
        **({"max_age": "0", "prompt": "login"} if step_up else {}),
    })
    return f"{endpoint}?{q}"


@router.get("/auth/login")
def auth_login(step_up: bool = False):
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = _b64(hashlib.sha256(verifier.encode()).digest())
    resp = RedirectResponse(_authorize_url(state, nonce, challenge, step_up=step_up),
                            status_code=302)
    resp.set_cookie(FLOW_COOKIE,
                    sign_payload({"state": state, "nonce": nonce, "v": verifier,
                                  "step_up": step_up,
                                  "exp": time.time() + FLOW_TTL_S}),
                    max_age=FLOW_TTL_S, httponly=True, samesite="lax",
                    secure=_cookie_secure(), path="/admin/v1/auth")
    return resp


@router.get("/auth/callback")
def auth_callback(request: Request, code: str = "", state: str = "",
                  error: str = ""):
    from .main import audit
    from .rbac import Actor

    def fail(reason: str) -> RedirectResponse:
        # The SPA is hash-routed, so notices ride a 60s cookie (never the URL —
        # fragments get eaten by the router and query strings hit server logs).
        resp = RedirectResponse("/", status_code=302)
        resp.delete_cookie(FLOW_COOKIE, path="/admin/v1/auth")
        resp.set_cookie(NOTE_COOKIE, urllib.parse.quote(f"error:{reason}"),
                        max_age=60, samesite="lax", secure=_cookie_secure(),
                        path="/")
        return resp

    if error:
        return fail(error)
    flow = read_payload(request.cookies.get(FLOW_COOKIE))
    if flow is None:
        return fail("sign-in flow expired — try again")
    if not code or not hmac.compare_digest(flow.get("state", ""), state):
        return fail("state mismatch")
    try:
        claims = verify_id_token(_exchange_code(code, flow["v"]), flow["nonce"])
    except AuthFlowError as exc:
        return fail(str(exc))

    email = claims["email"].lower()
    role = directory_role(email)
    if role is None:
        audit(Actor(id=email, role=Role.RO), "auth.denied", email,
              {"reason": "not_provisioned"}, request)
        resp = RedirectResponse("/", status_code=302)
        resp.delete_cookie(FLOW_COOKIE, path="/admin/v1/auth")
        resp.set_cookie(NOTE_COOKIE,
                        urllib.parse.quote(f"not_provisioned:{email}"),
                        max_age=60, samesite="lax", secure=_cookie_secure(),
                        path="/")
        return resp

    # When the IdP reports when the person actually authenticated, that is the
    # step-up clock; the dev IdP (no auth_time) authenticates on every visit.
    auth_time = float(claims.get("auth_time") or time.time())
    if flow.get("step_up") and time.time() - auth_time > 120:
        # The IdP ignored max_age/prompt and replayed an old session: refuse
        # to treat it as a fresh sign-in.
        return fail("the identity provider did not re-authenticate you — try again")
    resp = RedirectResponse("/", status_code=302)
    resp.delete_cookie(FLOW_COOKIE, path="/admin/v1/auth")
    resp.set_cookie(SESSION_COOKIE,
                    sign_payload({"email": email,
                                  "name": claims.get("name", ""),
                                  "sid": secrets.token_hex(8),
                                  "iat": time.time(),
                                  "auth_time": auth_time,
                                  "exp": time.time() + SESSION_TTL_S}),
                    max_age=SESSION_TTL_S, httponly=True, samesite="lax",
                    secure=_cookie_secure(), path="/")
    audit(Actor(id=email, role=Role(role)), "auth.login", email,
          {"role": role, "idp": "dev" if internal_idp() else "oidc"}, request)
    return resp


@router.get("/auth/me")
def auth_me(request: Request):
    if auth_mode() != "oidc":
        actor = request.headers.get("x-actor-id", "")
        return {"mode": "headers", "authenticated": bool(actor),
                "email": actor, "role": request.headers.get("x-role", "")}
    base = {"mode": "oidc", "devIdp": internal_idp(),
            "login": "/admin/v1/auth/login"}
    ident = session_identity(request)
    if ident is None:
        return {**base, "authenticated": False}
    role = directory_role(ident["email"])
    if role is None:
        return {**base, "authenticated": False, "reason": "not_provisioned",
                "email": ident["email"]}
    return {**base, "authenticated": True, "email": ident["email"],
            "name": ident.get("name", ""), "role": role,
            "since": ident.get("iat", 0)}


@router.post("/auth/logout")
def auth_logout(request: Request):
    from .main import audit
    from .rbac import Actor
    # Same CSRF rule as every other mutation: a cross-site form must not be
    # able to sign an operator out mid-task.
    if request.headers.get("x-katha-csrf") != "1":
        raise HTTPException(status_code=403, detail="missing X-Katha-CSRF header")
    ident = session_identity(request)
    if ident is not None:
        role = directory_role(ident["email"]) or "ro"
        audit(Actor(id=ident["email"], role=Role(role)), "auth.logout",
              ident["email"], {}, request)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE, path="/")
    return resp


_DEV_PAGE = """<!doctype html><meta charset="utf-8">
<title>Katha dev sign-in</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;
  background:#111015;color:#EDEAE4;font:15px/1.5 system-ui">
<form method="post" style="background:#1A1920;border:1px solid #2E2B35;
  border-radius:12px;padding:28px;width:340px">
  <div style="font-weight:700;font-size:18px">Katha · dev identity provider</div>
  <p style="color:#98939E;margin:8px 0 16px">Local stand-in for Google Workspace.
  Sign in as any address — the server still decides your role.</p>
  {quick}
  <input name="email" type="email" required placeholder="you@katha.dev"
    style="width:100%;box-sizing:border-box;background:#111015;color:#EDEAE4;
    border:1px solid #2E2B35;border-radius:8px;padding:10px 12px;margin-bottom:10px">
  <button style="width:100%;background:#F65428;color:#fff;border:0;
    border-radius:8px;padding:10px;font-weight:700;cursor:pointer">Continue</button>
</form></body>"""


@router.get("/devidp/authorize")
def devidp_page(request: Request):
    if auth_mode() != "oidc" or not internal_idp():
        return JSONResponse({"detail": "not found"}, status_code=404)
    quick = "".join(
        f'<button name="email" value="{e}" formnovalidate style="display:block;width:100%;'
        f'margin-bottom:8px;background:#232129;color:#EDEAE4;border:1px solid #2E2B35;'
        f'border-radius:8px;padding:9px;cursor:pointer;font-family:ui-monospace,monospace">'
        f"{e} · {v['role']}</button>"
        for e, v in sorted(directory_all().items()) if v.get("role"))
    return HTMLResponse(_DEV_PAGE.replace("{quick}", quick))


@router.post("/devidp/authorize")
async def devidp_submit(request: Request):
    if auth_mode() != "oidc" or not internal_idp():
        return JSONResponse({"detail": "not found"}, status_code=404)
    # parse the urlencoded login form by hand — no python-multipart needed
    form = urllib.parse.parse_qs((await request.body()).decode())
    email = (form.get("email") or [""])[0].strip().lower()
    q = request.query_params
    redirect_uri = q.get("redirect_uri", "")
    if not email or redirect_uri != _redirect_url():
        return JSONResponse({"detail": "bad authorize request"}, status_code=400)
    code = secrets.token_urlsafe(24)
    _DEV_CODES[code] = {"email": email, "nonce": q.get("nonce", ""),
                        "challenge": q.get("code_challenge", ""),
                        "exp": time.time() + 120}
    sep = "&" if "?" in redirect_uri else "?"
    return RedirectResponse(
        f"{redirect_uri}{sep}code={code}&state={urllib.parse.quote(q.get('state', ''))}",
        status_code=302)


# --- who can sign in: the provisioned-operators directory (admin-only) ------

@router.get("/access/users")
def access_users(actor=Depends(require())):
    return {"users": [{"email": e, **v}
                      for e, v in sorted(directory_all().items()) if v.get("role")]}


@router.put("/access/users/{email}")
def access_grant(email: str, request: Request, body: dict = Body(...),
                 actor=Depends(require())):
    from .main import audit
    email = email.strip().lower()
    role = str(body.get("role", "")).strip().lower()
    if role not in {r.value for r in Role}:
        return JSONResponse({"detail": f"unknown role: {role}"}, status_code=400)
    if email == actor.id.lower():
        return JSONResponse({"detail": "you can't change your own access"},
                            status_code=409)
    if role == Role.ADMIN.value and body.get("confirm") != email:
        return JSONResponse(
            {"detail": f'granting admin needs confirm="{email}"'}, status_code=428)
    prev = directory_role(email)
    _directory_write(email, {"role": role, "by": actor.id, "at": now_iso()})
    audit(actor, "access.grant", email, {"from": prev or "none", "to": role},
          request)
    return {"email": email, "role": role}


@router.delete("/access/users/{email}")
def access_revoke(email: str, request: Request, actor=Depends(require())):
    from .main import audit
    email = email.strip().lower()
    if email == actor.id.lower():
        return JSONResponse({"detail": "you can't revoke your own access"},
                            status_code=409)
    if directory_role(email) is None:
        return JSONResponse({"detail": "not provisioned"}, status_code=404)
    admins = [e for e, v in directory_all().items()
              if v.get("role") == Role.ADMIN.value]
    if admins == [email]:
        return JSONResponse({"detail": "refusing to remove the last admin"},
                            status_code=409)
    directory_delete(email)
    audit(actor, "access.revoke", email, {}, request)
    return {"email": email, "role": None}

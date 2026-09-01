# Katha Admin — OIDC sign-in setup (v0.1, 2026-09-01)

The back office authenticates operators with OpenID Connect (Authorization Code
+ PKCE). Identity comes from a verified RS256 ID token; the **role never comes
from the client** — it is resolved on every request from the server-side
directory (`adminuser:{email}` in the shared KV), so revocation is instant.
Sessions are stateless HMAC-signed HttpOnly cookies (SameSite=Lax, 12 h);
cookie-authenticated mutations must send `X-Katha-CSRF: 1` (the admin SPA
always does).

## Modes

| `KATHA_ADMIN_AUTH` | Behaviour |
|---|---|
| `headers` (default) | Historical dev path: `X-Actor-Id`/`X-Role` headers. The SPA shows "dev auth" and a role-preview switcher. |
| `oidc` | Headers are **ignored**. Sign-in required; the SPA shows the login gate. |

With `KATHA_ADMIN_AUTH=oidc`:

| `KATHA_OIDC_ISSUER` | Identity provider |
|---|---|
| unset | Built-in **dev IdP** (localhost only): a real authorize→code→ID-token flow, RS256-signed, PKCE-checked — the verification code path is identical to production. Anyone can claim any email, but only provisioned emails get in. |
| `https://accounts.google.com` | Google Workspace, via standard discovery + JWKS. |

## Dev quickstart (what runs today)

```sh
KATHA_PERSIST=1 KATHA_DB_URL="sqlite+aiosqlite:////tmp/katha_shared.db" \
KATHA_ADMIN_AUTH=oidc \
PYTHONPATH="packages/domain:packages/ledger:packages/infra:services/admin-api:services/core-api" \
.venv/bin/python -m uvicorn admin_app.main:app --port 8800
```

Open the admin SPA (vite on :5174, which proxies `/admin/v1` → :8800 so cookies
stay same-origin). First sign-in: `ops@katha.dev` (bootstrap admin). Provision
everyone else in **Roles & access → Provisioned operators**.

- Bootstrap seed: `KATHA_ADMIN_USERS="you@katha.dev:admin,riya@katha.dev:support"`
  (applies only while the directory is empty; UI changes win afterwards).
- Roles: admin, content, qc, support, finance, analyst, ro.
- Granting **admin** (API or UI) requires typing the email as confirmation (HTTP 428 otherwise).
- You cannot change/revoke your own entry, and the last admin cannot be removed.
- Every login, denial, logout, grant, and revoke lands in the hash-chained audit log with IP.

## Switching to Google Workspace (the one part only you can do)

1. In [Google Cloud console](https://console.cloud.google.com) pick/create a
   project → **APIs & Services → OAuth consent screen**: User type **Internal**
   (limits sign-in to your Workspace), fill app name + contacts. No scopes
   beyond the defaults needed (openid/email/profile are standard).
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URIs — exactly the callback URL the panel uses:
     - dev: `http://localhost:5174/admin/v1/auth/callback`
     - prod: `https://admin.katha.dev/admin/v1/auth/callback` (your real host)
3. Copy the Client ID and Client secret into the admin-api environment:

```sh
KATHA_ADMIN_AUTH=oidc
KATHA_OIDC_ISSUER=https://accounts.google.com
KATHA_OIDC_CLIENT_ID=<client-id>.apps.googleusercontent.com
KATHA_OIDC_CLIENT_SECRET=<client-secret>
KATHA_OIDC_REDIRECT_URL=https://admin.katha.dev/admin/v1/auth/callback
KATHA_OIDC_HD=katha.dev                 # optional: hard-require your Workspace domain
KATHA_ADMIN_SESSION_SECRET=<openssl rand -hex 32>   # stable across restarts/instances
KATHA_ADMIN_COOKIE_SECURE=1             # HTTPS only
KATHA_ADMIN_USERS="you@katha.dev:admin" # first admin bootstrap
```

That's the whole switch — no code changes. The dev IdP disappears (404) the
moment a real issuer is set.

## Production notes

- **Stateless by design**: sessions AND in-flight flow state (state/nonce/PKCE
  verifier) live in signed cookies, so multiple admin-api instances need no
  shared session store — only the same `KATHA_ADMIN_SESSION_SECRET`.
- Rotating `KATHA_ADMIN_SESSION_SECRET` signs everyone out (that's the
  break-glass lever). Revoking one person = removing them in Roles & access —
  takes effect on their next request.
- ID-token checks enforced: signature via issuer JWKS (cached, refetched on
  unknown kid), `iss`, `aud`, `exp`/`iat` (60 s leeway), nonce binding,
  `email_verified`, optional `hd`.
- CSRF model: strict CORS allowlist (`KATHA_ADMIN_CORS`) + SameSite=Lax +
  required custom header on unsafe methods.
- `KATHA_ADMIN_SESSION_TTL_H` (default 12) bounds session lifetime.
- Keep `KATHA_ADMIN_AUTH=headers` only for local unit-test runs; never expose
  a headers-mode admin-api beyond localhost.

## Ops platform env (added 2026-09-01, wave 3)

| Variable | Default | What it does |
|---|---|---|
| `KATHA_ALERT_WEBHOOK` (or KV `config:alert.webhook`) | unset | Slack-compatible webhook: new pending approvals and un-acked danger attention items post `{"text": ...}` once (deduped). Paste a Slack *Incoming Webhook* URL to go live. |
| `KATHA_ADMIN_RATE_LIMIT` | 240/min | Per-actor mutation rate limit (429 beyond). |
| `KATHA_ADMIN_STEP_UP_S` | 900 | Money actions (approve/refund/erase/sign-out-devices) refuse OIDC sessions older than this — the operator signs in again (step-up). |
| KV `config:adjust.daily_cap` | 2000 | Per-agent daily coin-adjustment cap; attention warns at 80%. |
| KV `config:coin.rupee_rate` | 0.15 | The coin→₹ rate used by LTV/analytics — finance edits one number. |

Prod posture notes (#080/#082/#084/#085): pin `KATHA_ADMIN_CORS` and `KATHA_CORS_ORIGINS`
to the real origins; admin-api already sends CSP/`X-Frame-Options: DENY`/nosniff on its
responses — mirror them on the SPA host (nginx `add_header`); move
`KATHA_ADMIN_SESSION_SECRET`/`KATHA_OIDC_CLIENT_SECRET` into a secret manager with
rotation; decide VPN/IP-allowlist before external exposure.

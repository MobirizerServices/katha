# Katha — production security posture (v0.1, 2026-09-01)

Closes admin-review #082 (secrets plan) and #084 (network posture). Scope: the
back office (admin-api + admin SPA) and the secrets both services carry.
Everything referenced here is enforced in code today unless marked *deploy-time*.

## 1. Network posture (#084) — DECIDED

**The back office is never exposed to the public internet.** Two layers:

1. **Primary: private access.** admin.katha.dev terminates inside the VPN
   (WireGuard/Tailscale for the team, or an IAP-style zero-trust proxy). The
   DNS record may be public; the origin only answers to the private network.
2. **In-app backstop (enforced now):** `KATHA_ADMIN_IP_ALLOWLIST` — comma-
   separated CIDRs and/or exact hosts. When set, admin-api returns 403 to any
   other caller before auth even runs. Example:
   `KATHA_ADMIN_IP_ALLOWLIST=10.8.0.0/24,100.64.0.0/10`. Unset = open (dev).

Defense stack in front of any money action, in order: network (VPN/allowlist)
→ OIDC session (Google Workspace, 2FA enforced at the IdP) → role from the
server-side directory → step-up freshness (≤15 min for approve/refund/erase)
→ dual approval above 500 coins → per-agent daily caps → rate limits → the
hash-chained audit.

## 2. Secrets inventory & plan (#082)

| Secret | Holder | Dev today | Production plan |
|---|---|---|---|
| `KATHA_ADMIN_SESSION_SECRET` | admin-api | random per boot | Secret manager (AWS SM / GCP SM); one value shared across instances; **rotating it signs every operator out — the break-glass lever**. Rotate quarterly + on suspicion. |
| `KATHA_OIDC_CLIENT_SECRET` | admin-api | unused (dev IdP) | Secret manager; rotate via Google console (create second secret → swap → delete first, zero downtime). |
| `KATHA_JWT_SECRET` | core-api | dev constant | Secret manager. Rotation strategy: dual-secret verify window (accept old+new for 30 d — the token TTL) or accept a forced all-user re-login. Per-user revocation already exists via token_version. |
| Payment webhook secrets (Razorpay), App Store keys | core-api | n/a (stubs) | Secret manager from day one; never in env files or the repo. |
| `KATHA_ALERT_WEBHOOK` | admin-api | unset | Treat the Slack URL as a secret (it grants post rights). |
| DB URLs / credentials | both | local SQLite path | Managed Postgres with IAM auth or rotated credentials via secret manager. |

Rules (all deploy-time): secrets reach processes as env vars **injected by the
orchestrator from the secret manager**, never committed, never in shell
history or Compose files; distinct values per environment; access to the
secret manager itself is role-gated and audited.

## 3. Headers, CORS, TLS

- admin-api already sends `Content-Security-Policy: default-src 'none'`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer` on every response (#085).
- The SPA host mirrors them (nginx): `add_header Content-Security-Policy
  "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'";`
  plus the three above and `Strict-Transport-Security: max-age=31536000`.
- `KATHA_ADMIN_CORS` / `KATHA_CORS_ORIGINS` pinned to the real origins (#080);
  `KATHA_ADMIN_COOKIE_SECURE=1` everywhere TLS terminates.

## 4. Standing review

Quarterly: rotate the session secret, re-check the provisioned-operators list
against the org chart, verify the audit chain export is archived (7-year money
retention per policy), and re-run the Playwright money-path suite against
staging (`npm run test:e2e` in web/admin).

## 5. Comms transports (added 2 Sep 2026)

Outbound comms are **outbox-first**: every email/push writes an `outbox` row
before any delivery attempt (admin → Outbox shows queued/sent/failed truth).
Transports activate purely by env:

| Variable | Purpose |
|---|---|
| `KATHA_SMTP_URL` (`smtp://user:pass@host:587` or `smtps://…:465`) + `KATHA_EMAIL_FROM` | Invoice + grievance emails deliver over SMTP; unset = dev (queued only). Treat as secrets. |
| `KATHA_APNS_KEY_P8` (path), `KATHA_APNS_KEY_ID`, `KATHA_APNS_TEAM_ID`, `KATHA_APNS_TOPIC`, `KATHA_APNS_ENV=prod` | Episode-drop pushes deliver to APNs over HTTP/2 with an ES256 provider token. The .p8 lives in the secret manager, never the repo. |
| `KATHA_GSTIN` | Printed on every web-purchase tax invoice (default marks registration pending). |

Invoices: GST @18% carved out of the GST-inclusive pack price, numbered
`KATHA-INV-<FY>-NNNNNN` per financial year, emailed on the web (UPI) order and
listed in-app (`GET /v1/me/invoices`). Apple invoices IAP purchases itself.

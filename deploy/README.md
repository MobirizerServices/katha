# Katha QA deployment

Runbook for standing up the QA stack (~100 testers) and the status of every
production-readiness item. Full plan: the readiness artifact.

## Bring-up

```bash
# 1. secrets — the backend refuses to boot on missing/dev-default secrets (prodguard)
cp deploy/.env.qa.example .env
#   generate real values:
#   openssl rand -hex 32   → KATHA_JWT_SECRET, KATHA_STREAM_SECRET, KATHA_ADMIN_SESSION_SECRET
#   set a strong POSTGRES_PASSWORD, your OIDC app creds, and the pinned origins

# 2. TLS certs → deploy/certs/{fullchain.pem,privkey.pem}
#   Let's Encrypt (certbot) for real hosts, or self-signed for an internal QA box:
#   mkdir -p deploy/certs && openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
#     -keyout deploy/certs/privkey.pem -out deploy/certs/fullchain.pem -subj "/CN=qa.katha.example"

# 3. bring up the whole stack (postgres, redis, both APIs, arq worker, web apps, nginx)
docker compose -f docker-compose.qa.yml up -d --build
#   the `backend` service runs `alembic upgrade head` on start (KATHA_RUN_MIGRATIONS=1)

# 4. verify
curl -k https://qa.katha.example/health     # {"status":"ok",...}
curl -k https://qa.katha.example/ready       # {"ready":true,...}
```

## Load test before opening QA

```bash
BASE_URL=https://qa.katha.example k6 run deploy/loadtest/katha.js
# thresholds (p95<500ms, <1% errors) fail the run — fix regressions before inviting testers
```

## Migrations

```bash
cd backend
KATHA_DB_URL=postgresql+asyncpg://katha:PASS@HOST:5432/katha alembic upgrade head
# new schema change: edit models.py, then
alembic revision --autogenerate -m "what changed"   # review the generated file before committing
```

## Readiness status

| # | Item | State |
|---|------|-------|
| P0-1 | PostgreSQL (pooled, off /tmp) | **code done** — verify with Docker up |
| P0-2 | Alembic migrations + CI gate | **done** — CI applies + `alembic check` |
| P0-3 | Fail-closed secret guard | **done** — prodguard, 8 tests |
| P0-4 | Real OTP (MSG91/Twilio/console) | **code done** — set `KATHA_OTP_PROVIDER` + creds |
| P0-5 | Containerized services | **done** — images + compose |
| P0-6 | nginx + TLS + headers + pinned CORS | **done** — add certs + server_name |
| P0-7 | Rate limiting (edge + app) | **done** — nginx zones + Redis-backed OTP guard |
| P0-8 | Media off the app tier (X-Accel) | **done** — `KATHA_XACCEL=1` |
| P1-1 | Redis (cache / limiter / broker) | **wired** — `KATHA_REDIS_URL` |
| P1-2 | Async worker (arq) | **scaffold** — worker runs; wire enqueues per endpoint |
| P1-3 | Observability | **done** — Sentry + JSON logs + `/ready` |
| P1-4 | Backups + restore drill | **runbook only** — schedule `pg_dump`, rehearse restore |
| P1-5 | CD + pinned deps | **partial** — requirements + CI build/scan; add deploy + hashed pins |
| P1-6 | Load test to 100+ | **done** — `deploy/loadtest/katha.js` |
| P1-7 | Production APNs | **needs your key** — push worker stub in place |

## Needs your accounts / credentials (can't be provisioned from the repo)

- **OTP SMS** — MSG91 or Twilio Verify account → set `KATHA_OTP_PROVIDER` + keys.
- **APNs** — production push key/cert for real new-episode alerts.
- **Sentry** — project DSN → `SENTRY_DSN`.
- **OIDC** — admin IdP app (Google/Okta) → `KATHA_OIDC_*`.
- **TLS** — domain + certs (Let's Encrypt) for `qa.katha.example` / `admin-qa.katha.example`.
- **P2 (pre-public)** — CDN + real transcode pipeline, WAF/DDoS edge, real
  StoreKit/SIWA verification, DPDP retention/DSR tooling, on-call + staging parity.

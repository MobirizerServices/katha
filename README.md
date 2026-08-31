# Katha

India-first micro-drama streaming platform — native iOS (SwiftUI) · FastAPI backend · Next.js web · React admin · LangGraph AI platform. Coin-unlock monetization (first 10 episodes free, then unlock with coins). See `docs/` for the full PDD, SAD and design mockups.

## Status (bootstrap — v0.1)

This repo is bootstrapped with a **verified backend money-core** and scaffolds for every surface. What actually runs and is tested today:

| Area | State | Verify |
|---|---|---|
| `backend/packages/ledger` — append-only coin ledger (PDD §12.7) | **Working, 14 tests pass** | `make test-backend` |
| `backend/services/core-api` — catalog, playback auth, wallet, IAP, web orders, unlock | **Working, 10 API tests pass, boots on uvicorn** | `make api` then `curl :8799/health` |
| `contracts/openapi/core-api.json` — 12 paths | **Generated from the app** | `make openapi` |
| `ios/KathaKit` — pure coin-math (optimistic UI) | **Working, 5 Swift tests pass** | `make test-ios` |
| `web/site` (Next.js), `web/admin` (React) | Scaffold — designs in `docs/*.html` | `make web` |
| `admin-api`, `ai-service`, `workers`, `alembic`, `infra/terraform` | Scaffold (health stubs / READMEs) | — |

The money loop is real end-to-end: buy a pack → coins credited → unlock E11 → playback returns a signed URL — all through the pure ledger, idempotent, bonus-spent-first, with the +10% web bonus and 25% bundle discount matching the mockups.

## Quick start

```bash
make setup      # venv + backend deps (needs uv)
make test       # backend (24 tests) + iOS (5 tests)
make api        # core-api on :8799 — serves the 6 crawled seed series
make openapi    # regenerate the OpenAPI contract
```

## Layout

```
katha/
├── backend/                    # Python 3.12 · FastAPI · modular monolith, 4 deployables, one Postgres (ADR-002)
│   ├── packages/
│   │   ├── ledger/             # append-only coin ledger — pure, dependency-free, 100%-tested (the money spine)
│   │   ├── domain/             # Pydantic schemas + catalog/pricing (source for OpenAPI → clients)
│   │   └── infra/              # db/cache/queue/storage/cdn adapters (stubs in v0.1)
│   ├── services/
│   │   ├── core-api/           # public mobile + web API  ← working slice
│   │   ├── admin-api/          # back-office API (RBAC + audit, OIDC)   [scaffold]
│   │   ├── ai-service/         # LangGraph graphs + model gateway       [scaffold]
│   │   └── workers/            # Celery families: media/money/comms/feed/ai/housekeeping [scaffold]
│   └── alembic/                # single migration history
├── contracts/                  # OpenAPI 3.1 specs + event JSON-Schema registry — SOURCE OF TRUTH for clients
│   ├── openapi/core-api.json   # generated from the app in CI (drift-gated)
│   └── events/                 # event schemas (e.g. paywall_view)
├── ios/
│   └── KathaKit/               # pure Swift value logic (SwiftPM) — the app's feature modules build on this
├── web/
│   ├── site/                   # Next.js 15 — public site + logged-in web watch app (two modes, SAD §5.5)
│   └── admin/                  # React 19 + Vite admin dashboard (talks only to admin-api)
├── infra/terraform/            # AWS ap-south-1 (ECS, RDS, Redis, SQS, S3+CloudFront, Secrets)  [scaffold]
├── tools/                      # dev/build scripts (e.g. placeholder-media generator)
├── docs/                       # PDD, SAD, ADRs, design mockups, pilot brief, seed catalog
├── media/                      # generated HLS dev catalog — GITIGNORED (regenerate: make seed-media)
├── Makefile · docker-compose.yml · .github/workflows/ci.yml
```

**Conventions.** Contracts-first: Swift/TS clients are generated from `contracts/` (gitignored, regenerated in CI). All business rules (price, entitlement, ranking) live server-side; clients render state. Money is an append-only ledger; balances are projections. The generated `media/` HLS catalog and all secrets are never committed. Android (Phase 5) slots in as `android/` beside `ios/`, a new client of the same `contracts/`.

> The canonical structure was designed via a multi-agent workflow (proposals → synthesis → completeness critique); this README reflects the built tree.

# Katha — Canonical Monorepo Structure (design reference)

> Produced by a multi-agent design workflow (4 independent proposals → synthesis → adversarial completeness critique → finalized tree). This is the **target** structure; the built repo follows it in spirit — the real tree lives in the root `README.md`. Adopt remaining refinements incrementally.

## Adoption status (2 September 2026)

**Adopted and running:** the surface split (backend packages/services, contracts/, ios/ with a pure kit + generated app project, web/site + web/admin, tools/, docs/); contracts-first with committed OpenAPI **and two-sided drift gates** (`tools/gen_admin_types.py` + a backend contract test + a client path-inventory test — a stronger form of the codegen rule); the universal Makefile (`setup/test/api/admin/test-e2e/gen-contracts/seed-media`); per-surface coverage gates (98 lines / 95 branches) instead of the plain `test` target; the regenerable dev media catalog (still at `media/`, gitignored — the `.dev-media/` rename and `git rm --cached` cutover are moot since media was never committed).

**Deliberately different in the dev build:** one shared SQLite ledger DB with an `admin_kv` control-plane table stands in for postgres/redis (SAD ADR-016 — same seams, engine swap at deploy); no docker-compose infra needed yet; admin e2e lives at `web/admin/e2e/` (Playwright) rather than a root `e2e/`.

**Not yet adopted:** `mise.toml`, `CONTRIBUTING.md`/`CODEOWNERS`, `.env.example`, pre-commit config, the `seed/` top-level move (seed JSON lives in `docs/` + the core-api data dir), ai-service/workers beyond scaffolds, `infra/terraform` build-out. One caution learned the hard way: **never gitignore bare `*.ts`** for HLS segments — it silently swallows TypeScript; scope media ignores to the media directory.

## Folder structure

```
katha/                                     # monorepo root — a clean list of SURFACES; no language toolchain files at root
├── README.md                              # START HERE: `make setup && make up`, tree tour, committed-vs-generated map,
│                                          #   "compose boots INFRA only; the 4 services run via `make dev-*` (uv)"
├── CONTRIBUTING.md                        # branch/PR flow, codegen rules, "routers never touch ORM", outbox invariant
├── CODEOWNERS                             # SINGLE location (root). ownership by surface/schema; .github/CODEOWNERS removed
├── LICENSE
├── Makefile                               # UNIVERSAL entrypoint: help|setup|up|down|gen|migrate|seed|dev-media|test
│                                          #   + dev-api|dev-admin|dev-ai|dev-workers|dev-beat (run each service via uv)
│                                          #   + e2e (full-stack smoke), cutover-media (`git rm -r --cached media/`)
├── docker-compose.yml                     # LOCAL INFRA ONLY: postgres(one db, many schemas), redis, localstack(sqs+s3),
│                                          #   minio, vector-enabled postgres image — services are NOT booted here
├── docker-compose.override.yml.example    # copy → optionally boot a subset of services / attach debuggers
├── mise.toml                              # pins python 3.12, node 20, pnpm, uv, swift 6, terraform (one place)
├── .env.example                           # COMMITTED template documenting every var; real .env is GITIGNORED
├── .editorconfig
├── .pre-commit-config.yaml
├── .dockerignore
├── .gitattributes                         # text normalization + Git-LFS globs for heavy design/pilot binaries
├── .gitignore                             # ── THE HYGIENE CONTRACT (three tiers) ──
│                                          #  generated: .dev-media/  **/Generated/  web/**/generated/  **/*.gen.yaml
│                                          #             backend/packages/generated/src/  .build/ DerivedData/
│                                          #             *.xcodeproj/ .next/ dist/ node_modules/ .venv/  ios/**/openapi.yaml(synced)
│                                          #  secrets:   .env  *.p8  *.pem  *.mobileprovision  ios/Config/Secrets.xcconfig
│                                          #             **/*.tfvars (except *.example)
│                                          #  state:     *.tfstate*  .terraform/  __pycache__/  .DS_Store  *.xcuserstate
│                                          #  NOTE: legacy committed media/ retired via `git rm -r --cached media/` (see Makefile)
│
├── .dev-media/                            # GITIGNORED WHOLESALE — regenerable HLS test catalog (dot-prefix sorts to top,
│   └── (manifest.json + per-series HLS)   #   structurally impossible to `git add .`). Written by tools/media-gen. PROD = S3+CDN.
│
├── seed/                                  # COMMITTED — small deterministic DATA (not docs, not media)
│   └── catalog/
│       └── seed-catalog.json              #   shared input for BOTH backend seeder AND media-gen; carries per-locale fields
│
├── contracts/                             # ══ SOURCE OF TRUTH — hand-authored; ALL clients generated FROM here ══
│   ├── README.md                          #   DIRECTIONAL RULE (one way only): "specs/schemas generate models & clients;
│   │                                      #   code IMPORTS generated. Nothing is hand-written-then-checked."
│   ├── openapi/
│   │   ├── core-api.openapi.yaml           #   OpenAPI 3.1 — iOS Networking + web/site (+ future android). Includes
│   │   │                                   #     POST /v1/events (body $ref's the bundled event union), payment webhook ops
│   │   ├── admin-api.openapi.yaml          #   OpenAPI 3.1 — web/admin ONLY
│   │   └── ai-service.openapi.yaml         #   OpenAPI 3.1 — INTERNAL; core-api & workers are generated clients of it
│   ├── events/                            # event JSON-Schema registry (analytics + domain events)
│   │   ├── registry.json                   #   index: event name → schema file → version
│   │   ├── schemas/*.event.schema.json
│   │   └── events.bundle.json              #   GENERATED discriminated-union bundle (tools/codegen/bundle_events.py);
│   │                                       #     core-api.openapi.yaml POST /v1/events $ref's it → ONE validated binding
│   ├── queue/                             # SQS / Celery message models — SOURCE (spec), not a mirror of code
│   │   └── *.msg.schema.json
│   ├── codegen/                           # generator CONFIG next to specs; OUTPUT lands in consumers (all gitignored)
│   │   ├── swift-api.yaml                   #   swift-openapi-generator → ios .../Networking/Generated
│   │   ├── swift-events.yaml                #   event structs → ios .../Analytics/Generated   (fixes event-drift on iOS)
│   │   ├── typescript-site.yaml             #   openapi-ts → web/site/src/lib/api/generated (core-api)
│   │   ├── typescript-events.yaml           #   event types → web/site/src/lib/events/generated (fixes web event drift)
│   │   ├── typescript-admin.yaml            #   openapi-ts → web/admin/src/api/generated (admin-api)
│   │   ├── python-messages.yaml             #   datamodel-codegen (events+queue) → katha.generated.messages / .events
│   │   ├── python-ai-client.yaml            #   openapi-python-client → katha.generated.ai_client  (INTERNAL svc client)
│   │   └── kotlin.yaml                       #   RESERVED → android (Phase 5), already wired
│   ├── baseline/                          # last-released specs → additive-only / breaking-change diff gate
│   └── .spectral.yaml                     # spec lint, used by CI contract gate
│
├── backend/                               # ══ PYTHON 3.12 — self-contained uv WORKSPACE; ALL code under the `katha.*` namespace ══
│   ├── pyproject.toml                     #   uv WORKSPACE root: members = packages/*, services/*  +  shared ruff/mypy/pytest
│   │                                      #   + [tool.importlinter] CONTRACTS written against REAL dotted paths:
│   │                                      #     (1) katha.*.routers may NOT import katha.*.models or sqlalchemy
│   │                                      #     (2) katha.domain.* imports the ledger ONLY via katha.ledger.client/.ports
│   │                                      #     (3) katha.ledger.core may NOT import katha.infra (stays pure)
│   ├── uv.lock                            #   ONE lockfile for the whole backend (aligned versions are a feature)
│   ├── ruff.toml · mypy.ini · .python-version
│   ├── packages/                          # ── importable libraries (never deployed alone); PEP-420 namespace: src/katha/<pkg> ──
│   │   ├── domain/                        #   SQLAlchemy 2.0 async models + Pydantic v2 + per-domain services
│   │   │   ├── pyproject.toml              #     deps: katha.infra, katha.ledger(client only) → boundaries self-document
│   │   │   ├── src/katha/domain/
│   │   │   │   ├── base.py                 #       DeclarativeBase, mixins, SHARED unit-of-work helper (one AsyncSession
│   │   │   │   │                           #         spans domain-write + ledger sqlalchemy_adapter in one transaction)
│   │   │   │   ├── catalog/               #       owns schema "catalog"; models carry localized-content rows (i18n premise)
│   │   │   │   │   └── {models,schemas,service,repository,events}.py  # models.py = ONLY place tables are defined
│   │   │   │   ├── identity/              #       owns "identity": users, OTP, Apple, App Attest, sessions
│   │   │   │   ├── ledger/                #       owns NO tables — USE-CASES ONLY (purchase, spend-to-unlock)
│   │   │   │   ├── engagement/            #       owns "engagement": feed, progress, rewards, entitlement rows
│   │   │   │   ├── admin/                 #       owns "admin": roles, audit  (admin-api depends on THIS subpackage)
│   │   │   │   ├── ai/                    #       owns "ai": agent_run, drafts, embeddings refs (pgvector cols), checkpoints
│   │   │   │   └── outbox/                #       owns schema "outbox": transactional outbox rows written IN the same
│   │   │   │                               #         UoW as domain events; drained by workers/housekeeping relay → SQS
│   │   │   └── tests/                     #     COLOCATED
│   │   ├── ledger/                        #   ── THE EXTRACTABLE ISLAND: own MetaData, own schema, no outbound FKs ──
│   │   │   ├── pyproject.toml              #     minimal deps (stdlib + crypto); does NOT import katha.infra
│   │   │   ├── src/katha/ledger/
│   │   │   │   ├── core/{entry,balance,money,invariants}.py  # PURE append-only + projection, no I/O (~100% tested)
│   │   │   │   ├── verifiers/{apple.py,razorpay.py}          # App Store + Razorpay/UPI SIGNATURE verify (pure)
│   │   │   │   ├── ports.py                #       LedgerPort protocol = the SEAM callers depend on
│   │   │   │   ├── client.py               #       LedgerClient facade = the ONLY symbol callers import
│   │   │   │   ├── models.py               #       ORM for schema "ledger" (own MetaData) INCLUDING webhook_receipt +
│   │   │   │   │                           #         idempotency_key tables that guard inbound-notification replay
│   │   │   │   ├── adapters/
│   │   │   │   │   ├── sqlalchemy_adapter.py #     in-proc: is HANDED the caller's AsyncSession (shares the UoW/txn)
│   │   │   │   │   └── http_adapter.py       #     future extraction: swaps at DI root — CAVEAT: converts the in-proc
│   │   │   │   │                             #       ACID write into a distributed call needing the outbox/saga
│   │   │   │   └── errors.py
│   │   │   └── tests/                     #     ~100% coverage gate in its OWN CI leg
│   │   ├── infra/                         #   side-effect adapters (the only place I/O lives)
│   │   │   ├── pyproject.toml
│   │   │   ├── src/katha/infra/
│   │   │   │   ├── {db,cache,queue,storage,cdn_signer,sms,apns,metrics}.py
│   │   │   │   ├── observability.py        #       OpenTelemetry tracing + structured logging (request-scoped, cross-svc)
│   │   │   │   └── health.py               #       shared liveness/readiness helpers mounted by every service (/healthz /readyz)
│   │   │   └── tests/
│   │   ├── generated/                     #   codegen LANDING ZONE (skeleton committed; src/ GITIGNORED, filled by `make gen`)
│   │   │   ├── pyproject.toml              #     provides katha.generated.* ; depended on by services that need it
│   │   │   └── src/katha/generated/{events,messages,ai_client}/   # events+queue models + INTERNAL ai-service client
│   │   └── testkit/                       #   dev-only: factories, fixtures, fakes/testcontainers (shared, no copy-paste)
│   │       ├── pyproject.toml
│   │       └── src/katha/testkit/{factories,fixtures,fake_infra,containers}.py
│   ├── services/                          # ── DEPLOYABLES: 4 runtime processes, one Postgres (SAD ADR-002); src/katha/<svc> ──
│   │   ├── core-api/                      #   public + logged-in-web API
│   │   │   ├── pyproject.toml              #     deps: katha.domain, katha.infra, katha.ledger, katha.generated
│   │   │   ├── Dockerfile                  #     multi-stage; `uv sync --package core-api --frozen` → only this svc's deps
│   │   │   ├── .dockerignore               #     build context = backend/ (path deps resolve); trims siblings for cache
│   │   │   ├── src/katha/core_api/{main,config,deps}.py   # deps.py = DI ROOT (picks ledger sqlalchemy vs http adapter)
│   │   │   │   ├── middleware/             #       auth interceptor, ETag, request-id, idempotency (reads ledger.idempotency_key)
│   │   │   │   ├── routers/                #       call SERVICES + schemas ONLY (import-linter forbids ORM)
│   │   │   │   │   └── webhooks/           #       INBOUND ingestion: app_store_notifications_v2.py, razorpay_upi.py
│   │   │   │   │                           #         (verify via katha.ledger.verifiers; idempotent via ledger.webhook_receipt)
│   │   │   │   └── export_openapi.py       #       emits openapi.gen.yaml → CI diffs vs contracts/core-api
│   │   │   ├── openapi.gen.yaml            #     GITIGNORED emitted spec (drift artifact)
│   │   │   └── tests/{unit,integration,contract}/
│   │   ├── admin-api/                     #   RBAC + audit, Google Workspace OIDC; serves web/admin only
│   │   │   ├── pyproject.toml              #     deps: katha.domain (admin subpkg), katha.infra  (NO ledger)
│   │   │   ├── Dockerfile · .dockerignore · openapi.gen.yaml
│   │   │   ├── src/katha/admin_api/{main,deps}.py + auth/(oidc,rbac)/ + audit/ + routers/
│   │   │   └── tests/
│   │   ├── ai-service/                    #   LangGraph graphs + model gateway (heavy deps isolated to its image layer)
│   │   │   ├── pyproject.toml              #     deps: katha.domain(ai), katha.infra, langgraph, litellm, pgvector client
│   │   │   ├── Dockerfile · .dockerignore · openapi.gen.yaml
│   │   │   ├── src/katha/ai_service/{main}.py + graphs/ + gateway/(LiteLLM) + retrieval/(pgvector) + checkpoints/ + evals/
│   │   │   │                               #     checkpoints/ USES tables created by Alembic (langgraph auto-migrate DISABLED)
│   │   │   └── tests/{unit,integration,evals}/
│   │   ├── workers/                       #   Celery task families (one image; family selected by CMD/queue at deploy)
│   │   │   ├── pyproject.toml              #     deps: katha.domain, katha.infra, katha.ledger, katha.generated
│   │   │   ├── src/katha/workers/{app.py, media/,money/,comms/,feed/,ai/,housekeeping/}
│   │   │   │                               #     money/* uses the same LedgerClient seam; housekeeping/ holds the
│   │   │   │                               #     OUTBOX RELAY (reads domain.outbox → publishes to SQS, at-least-once)
│   │   │   └── tests/
│   │   └── scheduler/                     #   Celery beat singleton (periodic triggers only)
│   │       ├── pyproject.toml              #     deps: katha.infra (+ katha.workers task refs)
│   │       ├── Dockerfile · .dockerignore
│   │       ├── src/katha/scheduler/{beat.py,schedule.py}
│   │       └── tests/
│   └── migrations/                        # ── THE SINGLE Alembic history + migration-JOB image (renamed from alembic/) ──
│       ├── alembic.ini
│       ├── env.py                         #     imports domain + ledger + outbox MetaData → ONE target; SOLE authority for
│       │                                  #     `CREATE EXTENSION vector`, pgvector columns, AND langgraph checkpoint DDL
│       ├── Dockerfile                     #     migration-job image: RUN before core-api rollout (explicit deploy step)
│       └── versions/                      #     0001_initial · 0002_pgvector_extension · 0003_langgraph_checkpoints · ...
│                                          #     (ledger DDL rides the shared history TODAY; extraction requires a
│                                          #      migration-split — split ledger to its own history at that time)
│
├── ios/                                   # ══ Swift 6 / SwiftUI / iOS 17+ — ONE deployable (app + extensions) ══
│   ├── README.md                          #   `make gen && xcodegen generate && open Katha.xcworkspace`
│   ├── project.yml                        #   XcodeGen = source of truth → .xcodeproj GENERATED + GITIGNORED (no pbxproj conflicts)
│   ├── .swiftlint.yml · .swiftformat · Mintfile
│   ├── App/                               #   THIN app target — wires modules via AppCore DI, no business logic
│   │   ├── KathaApp.swift · Info.plist · Katha.entitlements   # entitlements list Universal-Link domains → AASA (web/site)
│   │   └── Resources/Assets.xcassets
│   ├── Config/
│   │   ├── Debug.xcconfig · Beta.xcconfig · Release.xcconfig
│   │   └── Secrets.xcconfig.example       #   COMMITTED template; real Secrets.xcconfig GITIGNORED
│   ├── Extensions/                        #   P1 targets
│   │   ├── Widgets/                        #     WidgetKit + ActivityKit (Live Activity)
│   │   └── AppClip/                        #     App Clip target (needs AASA served by web/site)
│   ├── Modules/                           #   ONE local SwiftPM package, one library target per feature module
│   │   ├── Package.swift                   #     single manifest = fast resolution, per-target incremental + test bundles
│   │   ├── Sources/
│   │   │   ├── AppCore/                    #       DI, config, deep-link router, session
│   │   │   ├── DesignSystem/               #       tokens, components, haptics
│   │   │   ├── Networking/                 #       auth interceptor, ETag cache (hand-written)
│   │   │   │   ├── openapi-generator-config.yaml  # IN-TARGET config for the swift-openapi build plugin (fixes the
│   │   │   │   ├── openapi.yaml             #         plugin-vs-contracts contradiction); openapi.yaml is a GITIGNORED
│   │   │   │   │                            #         copy synced from contracts/ by `make gen` — contracts stay the source
│   │   │   │   └── Generated/              #       plugin/CLI output — GITIGNORED
│   │   │   ├── Auth/                       #       phone OTP, Sign in with Apple (needs AASA), Keychain, App Attest
│   │   │   ├── Feed/ · Series/
│   │   │   ├── Player/                     #       AVFoundation wrapper, prefetch, capture protection
│   │   │   ├── Wallet/                     #       StoreKit 2, Transaction.updates (captures intent; server verifies)
│   │   │   ├── Rewards/
│   │   │   ├── Persistence/                #       SwiftData
│   │   │   ├── Analytics/                  #       event queue → POST /v1/events
│   │   │   │   └── Generated/              #         event structs from contracts/events (swift-events.yaml) — GITIGNORED
│   │   │   └── Localization/               #       String Catalogs (.xcstrings)
│   │   └── Tests/                          #     COLOCATED: AppCoreTests/, PlayerTests/, WalletTests/, ...
│   ├── Katha.xctestplan
│   └── fastlane/                          #   lint/test/beta lanes → TestFlight (secrets from env)
│
├── web/                                   # ══ JS/TS — self-contained pnpm WORKSPACE (isolated from backend) ══
│   ├── pnpm-workspace.yaml
│   ├── pnpm-lock.yaml
│   ├── tsconfig.base.json
│   ├── site/                              #   DEPLOYABLE: Next.js 15 — ONE codebase, TWO modes → SSR image on ECS
│   │   ├── package.json · next.config.ts · Dockerfile · .dockerignore · .env.example
│   │   ├── public/
│   │   │   └── .well-known/                #     apple-app-site-association (Universal Links, App Clip, Sign in w/ Apple)
│   │   │       ├── apple-app-site-association   #       served here; site is the natural host
│   │   │       └── assetlinks.json         #       RESERVED for android (Phase 5)
│   │   ├── src/
│   │   │   ├── app/[locale]/               #     i18n root segment (multi-language India-first catalog)
│   │   │   │   ├── (marketing)/            #       (a) public INDEXABLE SSR/ISR: landing, SEO series/episode, free playback
│   │   │   │   ├── (legal)/                #           legal / grievance
│   │   │   │   ├── (watch)/                #       (b) logged-in NOINDEX web watch app
│   │   │   │   └── (store)/                #           UPI coin store (captures intent; core-api prices/credits)
│   │   │   ├── app/sitemap.ts              #     dynamic sitemap.xml (SEO requirement)
│   │   │   ├── app/robots.ts               #     robots.txt (indexable marketing vs noindex app)
│   │   │   ├── components/player/          #     hls.js vertical player (shared by both modes)
│   │   │   ├── i18n/                       #     locale config + message catalogs
│   │   │   ├── lib/seo/                    #     JSON-LD structured-data builders (VideoObject, BreadcrumbList, ...)
│   │   │   ├── lib/api/generated/          #     TS client from contracts/core-api — GITIGNORED (`make gen`)
│   │   │   └── lib/events/generated/       #     TS event types from contracts/events — GITIGNORED (`make gen`)
│   │   ├── e2e/                            #     Playwright (site-local)
│   │   └── tests/                          #     colocated unit (vitest)
│   └── admin/                             #   DEPLOYABLE: React 19 + Vite → STATIC build to S3/CloudFront (no Docker)
│       ├── package.json · vite.config.ts · index.html · .env.example
│       └── src/
│           ├── api/generated/             #     TS client from contracts/admin-api ONLY — GITIGNORED (never core-api)
│           ├── features/ · routes/ · main.tsx
│           └── **/*.test.tsx              #     colocated
│
├── android/                               # ══ RESERVED (Phase 5) — sibling slot, zero restructuring ══
│   └── README.md                          #   "same contracts/; Kotlin client from codegen/kotlin.yaml lands here;
│                                          #    assetlinks.json already stubbed in web/site/public/.well-known"
│
├── e2e/                                   # CROSS-SERVICE smoke harness (fills the per-service-only test gap)
│   ├── docker-compose.e2e.yml             #   boots FULL stack (infra + all 4 services) for CI + local `make e2e`
│   ├── README.md
│   └── tests/                             #   pytest/Playwright: core-api → ai-service → workers end-to-end paths
│
├── infra/                                 # COMMITTED (state + secrets are NOT)
│   ├── terraform/                         #   AWS ap-south-1
│   │   ├── versions.tf · .terraform.lock.hcl   #   provider lock COMMITTED
│   │   ├── modules/{network,ecs-service,rds,redis,sqs,s3,cloudfront,secrets}/
│   │   └── environments/{dev,staging,prod}/{main.tf,backend.tf,terraform.tfvars.example}
│   │                                      #   *.tfstate → remote S3+DynamoDB; secrets → Secrets Manager
│   └── docker/                            #   shared warm base images each service FROMs
│       ├── python-base.Dockerfile          #     python:3.12-slim + uv + common wheels
│       └── node-base.Dockerfile
│
├── .github/
│   ├── paths-filter.yml                   #   one output flag per deployable + shared-package fan-out (change detection)
│   ├── workflows/
│   │   ├── ci.yml                          #   orchestrator: paths-filter → matrix-dispatch only changed units
│   │   ├── _py-service.reusable.yml        #   uv → ruff → mypy → import-linter → pytest(cov) → build+scan image → ECR
│   │   ├── _node-app.reusable.yml          #   pnpm --filter → lint → typecheck → test → build
│   │   ├── contracts.yml                   #   GATE: spectral + bundle_events + emitted openapi.gen.yaml == contracts/
│   │   ├── codegen-drift.yml               #   regen ALL clients (swift api+events, ts site+events+admin, py msgs+ai-client);
│   │   │                                   #     FAIL on any working-tree change → guarantees code imports generated
│   │   ├── ledger.yml                      #   packages/ledger ~100% coverage gate (isolated)
│   │   ├── e2e.yml                         #   full-stack smoke via e2e/docker-compose.e2e.yml
│   │   ├── ios.yml · web-site.yml · web-admin.yml · migrator.yml · terraform.yml
│   │   └── deploy.yml                      #   blue/green ECS; readiness-gated; migration-job runs BEFORE core-api rollout
│   ├── pull_request_template.md · dependabot.yml    #   (CODEOWNERS lives at ROOT only — not duplicated here)
│
├── docs/                                  # COMMITTED — prose + text HTML click-throughs only
│   ├── README.md
│   ├── adr/                                #   ADR-0002-fastapi-modular-monolith.md, ADR-…-ledger-extraction-split.md, ...
│   ├── architecture/SAD.md
│   ├── product/PDD.md
│   ├── runbooks/{deploy-blue-green,incident-ledger-reconciliation,db-restore}.md   #   reconciliation uses OTel traces
│   ├── mockups/                            #   Katha_iOS_Design_v0.3.html, Katha_Website_v0.1.html, Katha_WebApp_v0.1.html,
│   │                                       #   Katha_Admin_Dashboard_v0.2.html  (heavy binaries → Git-LFS)
│   └── pilot/Katha_Pilot_Episode_Brief_v0.1.md
│
└── tools/                                 # dev/build scripts (not shipped)
    ├── media-gen/
    │   ├── generate_placeholder_media.py   #   reads seed/catalog/seed-catalog.json → WRITES .dev-media/ (gitignored)
    │   ├── pyproject.toml · README.md
    ├── codegen/
    │   ├── bundle_events.py                 #   composes contracts/events/schemas → events.bundle.json (OpenAPI $ref target)
    │   ├── gen_swift.sh · gen_ts.sh · gen_py.sh · sync_ios_spec.sh   # sync_ios copies spec into Networking target
    │   └── check_contract_diff.sh
    ├── dev/{bootstrap.sh,seed_db.py,reset-db.sh}   #   seed_db.py loads seed/catalog into local Postgres
    └── ci/
```

## Key decisions & conventions

- **Monorepo tooling.** Root is a language-agnostic list of surfaces (`backend`, `ios`, `web`, `android`, `contracts`, `infra`, `e2e`, `docs`, `tools`, `seed`); no Python/JS toolchain files at root. `mise.toml` pins every runtime once; `Makefile` is the universal entrypoint (`setup|up|down|gen|migrate|seed|dev-media|test|e2e`).
- **Python packaging: ONE uv workspace, single `backend/uv.lock`, one shared `katha.*` namespace.** All packages and services are PEP-420 namespace packages under `src/katha/<name>/`, so import-linter contracts reference **real** dotted paths (`katha.ledger.core`, `katha.domain.catalog.models`, `katha.infra`) — the invariants actually match and can't go vacuously green. Each Dockerfile runs `uv sync --package <svc> --frozen` to install only its own subset (ai-service's heavy deps stay in its image layer); per-service `pyproject.toml` deps are explicit (admin-api → `katha.domain(admin)` + `katha.infra`, no ledger; core-api & workers → domain+infra+ledger+generated).
- **Contracts are the single source of truth; generated clients are gitignored and colocated.** Swift API + event structs (`ios/.../Networking/Generated`, `.../Analytics/Generated`), TS core-api + event types (`web/site/src/lib/api/generated`, `.../events/generated`), admin TS (`web/admin/src/api/generated`), and backend Pydantic message/event models plus the **internal ai-service Python client** (`katha.generated.*`) are all produced by `make gen` and never committed. The `POST /v1/events` body `$ref`s a generated `events.bundle.json`, so client event payloads and the server operation validate against **one** registry. `codegen-drift.yml` regenerates everything and fails on any diff; `contracts.yml` diffs each service's emitted `openapi.gen.yaml` against `contracts/`. The directional rule (specs generate models; code imports generated) is stated in `contracts/README` — no "mirror-and-check" anywhere.
- **Swift codegen contradiction resolved.** The generator config lives **in-target** (`ios/.../Networking/openapi-generator-config.yaml`) so the swift-openapi build plugin works; `make gen`/`sync_ios_spec.sh` copies the spec into the target as a gitignored `openapi.yaml`, keeping `contracts/` the only authored source.
- **Committed vs generated vs secret is a structural three-tier `.gitignore`.** Committed = source, `contracts/`, all lockfiles, `seed/catalog/seed-catalog.json`, docs incl. text-HTML mockups, generated-package skeletons. Generated = every `Generated/`, `web/**/generated/`, `*.gen.yaml`, `backend/packages/generated/src/`, build output, the synced iOS spec. Secret = `.env`, `*.p8`, `Secrets.xcconfig`, real `*.tfvars`/state.
- **HLS dev media is gitignored wholesale in dot-prefixed `.dev-media/`.** Regenerated by `tools/media-gen` from `seed/catalog/seed-catalog.json` via `make dev-media`; production/staging media is S3 + CloudFront, never git. The legacy committed `media/` is retired with an explicit `git rm -r --cached media/` (Makefile `cutover-media`), not just a new ignore rule.
- **Payment webhook ingestion has a home.** Inbound App Store Server Notifications v2 and Razorpay/UPI webhooks land in `core-api/routers/webhooks/`, appear in `core-api.openapi.yaml`, verify signatures via `katha.ledger.verifiers`, and are made idempotent by `ledger.webhook_receipt`/`ledger.idempotency_key` tables — so replays are safe and guarded next to the ledger write.
- **Money atomicity is explicit, and so is the extraction caveat.** `katha.ledger.core` is pure; `models.py` + `sqlalchemy_adapter.py` are the impure edge and are **handed the caller's `AsyncSession`** via the shared unit-of-work in `domain/base.py`, so a coin purchase (ledger append + engagement entitlement, two schemas, one Postgres) commits atomically. The future `http_adapter` swap at the DI root converts that ACID write into a distributed call requiring the outbox/saga — documented, not silently implied.
- **Transactional outbox + reliable event relay.** Domain events are written to a `domain.outbox` table inside the same transaction as the state change; a `workers/housekeeping` relay drains it to SQS at-least-once — closing the money-adjacent correctness gap for feed/comms/ai consumers.
- **Schema ownership is visible and CI-enforced.** One folder per Postgres schema under `backend/packages/domain/` (`catalog`, `identity`, `ledger`-usecases, `engagement`, `admin`, `ai`, `outbox`) plus `ledger` owning its own `ledger` schema, with `models.py` the sole place tables are defined. "Routers never touch the ORM," "domain reaches the ledger only via `LedgerClient`/`LedgerPort`," and "`ledger.core` never imports `infra`" are import-linter contracts checked in CI.
- **Single Alembic history at `backend/migrations/`, and it owns everything.** `env.py` combines domain + ledger + outbox MetaData into one target and is the **sole authority** for `CREATE EXTENSION vector`, pgvector columns, and the langgraph checkpoint tables (langgraph's auto-migration is disabled) — reconciling ADR-002's single-history claim. The migration-job image runs before core-api rollout; an ADR records the ledger-extraction migration-split plan.
- **Android slots in for Phase 5 with zero restructuring.** `android/` is a reserved sibling consuming the same `contracts/` via `codegen/kotlin.yaml`; its `assetlinks.json` is already stubbed in `web/site/public/.well-known/` alongside the `apple-app-site-association` that Universal Links, the App Clip, and Sign in with Apple require today.
- **Web SEO + i18n are first-class.** `web/site` uses a `[locale]` root segment, dynamic `sitemap.ts`/`robots.ts`, and `lib/seo` JSON-LD builders for the indexable series/episode pages, matching the India-first multi-language catalog and the iOS Localization module.
- **Secrets & dev orchestration.** All secrets stay out of git (`.env`, `*.p8`, `Secrets.xcconfig`, real `*.tfvars`) with `.example` templates committed; runtime secrets come from AWS Secrets Manager. `docker-compose.yml` boots **infra only** (postgres/redis/localstack/minio) — the four services run via `make dev-api|dev-admin|dev-ai|dev-workers|dev-beat` (uv) or the override file, documented in README so `make up` isn't mistaken for booting the app. Shared `katha.infra.health`/`observability` give every service `/healthz` `/readyz` and OpenTelemetry traces (readiness-gated blue/green; reconciliation runbook is trace-driven), and `e2e/` exercises core-api → ai-service → workers end-to-end.

---

## Completeness critique (what the final tree resolved)

**Verdict:** Structurally complete and faithful to the SAD/PDD — all three backend packages, all five services (scheduler included, which the live tree still lacks), every iOS SwiftPM module, both web/site modes, admin isolated to admin-api, the single Alembic home, and a drop-in android/ slot are present and the hygiene move (.dev-media/ vs today's committed media/) is correct; the real work left is at the seams (internal ai-service client, event-payload client codegen, payment-webhook ingestion, .well-known, langgraph/pgvector migration ownership, outbox, and ledger atomicity semantics) plus fixing the katha.* vs katha_* import-linter mismatch and the duplicated CODEOWNERS before this is truly canonical.

**Gaps the critic flagged (now addressed in the final tree):**
- Internal service-to-service client codegen is absent. contracts/openapi/ai-service.openapi.yaml exists and core-api/workers must call ai-service, but contracts/codegen/ has swift/ts-site/ts-admin/kotlin/python-messages only — no Python HTTP client target for ai-service. As drawn the caller either hand-writes the client (violates the contracts-first 'never hand-written' principle) or has no client at all.
- Event payloads are not generated for the clients that emit them. contracts/events/schemas feed ONLY python-messages.yaml; the iOS Analytics module and web both POST /v1/events bodies but there is no Swift/TS type generation from the event registry, so clients hand-craft event JSON and drift silently — the exact contracts-first failure the design forbids. Also undefined: how contracts/events/*.schema.json binds to the POST /v1/events request body inside core-api.openapi.yaml (is the operation schema-validated against the registry, or are they two unrelated sources?).
- Payment webhook / server-notification INGESTION has no home. packages/ledger/verifiers holds outbound Apple/Razorpay signature verification, but App Store Server Notifications v2 and Razorpay/UPI webhooks are inbound HTTP that must land in a router (core-api or a dedicated receiver) and appear in a spec, with an idempotency store. Neither the endpoint nor the idempotency mechanism is placed.
- No .well-known home in web/site. The AppCore deep-link router, the App Clip target, Universal Links, and Sign in with Apple all require web/site to serve /.well-known/apple-app-site-association (and later assetlinks.json for android). The public site is the natural host and it is not represented.
- Migration ownership of langgraph-checkpoint-postgres and pgvector is unreconciled with the SINGLE Alembic history (ADR-002). langgraph's checkpointer provisions its own tables and pgvector needs CREATE EXTENSION + vector columns; unless backend/migrations/env.py explicitly owns these, they become a second migration authority that contradicts the 'single Alembic history' claim. The tree lists domain/ai as owning 'checkpoints' and 'embeddings refs' but does not say Alembic manages the actual checkpoint/vector DDL.
- No transactional outbox / reliable domain-event relay. domain subpackages emit events (e.g. catalog/events.py) that feed/comms/ai workers consume over SQS, but there is no outbox table + relay to publish events atomically with the DB write. For a money-adjacent, append-only-ledger system this is a correctness gap, not a nicety.
- Generated Python message-model output location is unspecified. swift.yaml and the typescript configs name their target dirs; python-messages.yaml does not say where the generated Pydantic models land in backend. Worse, 'contracts/queue mirrors backend messages, CI-checked to match' reads as hand-write-then-check — the inverse of contracts-first generation. Direction of truth for queue models must be pinned.
- SEO scaffolding for the hard 'SEO series/episode pages' requirement is unplaced. web/site has (marketing) routes but no explicit sitemap.xml, robots.txt, or JSON-LD structured-data story — and no i18n surface for a multi-language India-first catalog, despite iOS carrying a full Localization module.
- Per-service pyproject deps are only shown for core-api (domain, infra, ledger). admin-api, ai-service, workers, and scheduler dependency edges are left implicit, so the self-documenting-boundaries claim is only half-realized; admin-api's dependence on packages/domain/admin (it has routers/auth/audit but no models) in particular should be explicit.

**Consistency notes:**
- import-linter contracts reference DOTTED namespaces (katha.ledger.core, katha.ledger.client, katha.domain.*, katha.infra) but the actual packages are FLAT underscore modules (src/katha_domain, src/katha_ledger, src/katha_infra). As written the contracts would not match any real import path and would be vacuously green in CI. Either adopt real namespace packages (katha.ledger.*) or rewrite the contracts against katha_ledger.* — otherwise the flagship 'invariants become CI-checkable' guarantee is broken.
- 'packages/ledger is pure' vs its own contents: the package holds models.py (SQLAlchemy) and adapters/sqlalchemy_adapter.py that do DB I/O — only ledger.core is pure. Because ledger.core may not import infra, the sqlalchemy_adapter has no engine/session of its own and must be handed the caller's AsyncSession; and to keep a coin purchase atomic (ledger append + engagement entitlement, two MetaData/schemas, one Postgres) it MUST share that same transaction. That coupling is unstated, and the future http_adapter swap silently converts an in-proc ACID write into a distributed call needing a saga/outbox — so 'swap one adapter, zero call-site changes' is misleading about atomicity. Make the shared-unit-of-work contract and the extraction's transactional consequence explicit.
- CODEOWNERS appears twice — root /CODEOWNERS and /.github/CODEOWNERS. GitHub honors the first file it finds and ignores the other; shipping both is a silent maintenance trap. Keep exactly one location.
- Swift codegen placement is internally contradictory: the config sits in contracts/codegen/swift.yaml, yet the note also promises a swift-openapi-generator 'build plugin.' The SwiftPM build plugin resolves its config and spec from INSIDE the Networking target, not from contracts/. As drawn only the `make gen` path works; either add an in-target generator config or drop the build-plugin claim.
- Naming drift between proposal and the migration/service facts: the tree calls the Alembic home backend/migrations/ (disk today is backend/alembic/) and the env.py must combine domain + ledger MetaData while the ledger is billed as an 'extractable island' — entangling ledger DDL in the shared history now with no stated plan for the future split. Consistent, but the extraction story needs the migration-split caveat spelled out.

**Improvements folded in:**
- Add a top-level cross-service e2e/smoke harness (docker-compose up full stack). Today coverage is per-service contract tests + web Playwright only; nothing exercises core-api -> ai-service -> workers end to end.
- State how backend services run locally: docker-compose.yml starts only infra deps (postgres/redis/localstack/minio), so document that the four services run via uv (or the override file) — otherwise `make up` looks like it should boot the app and does not.
- Add OpenTelemetry / structured-logging alongside infra/metrics.py; the incident-ledger-reconciliation runbook is only actionable with request-scoped tracing across core-api, workers, and the ledger.
- Define health/readiness endpoints and a shared convention — deploy.yml's blue/green + migration-job-before-core-api ordering depends on readiness gates that are not represented.
- Confirm the .gitignore hygiene contract against reality: the current disk has a COMMITTED top-level media/ (manifest.json + per-episode HLS) and a backend/.venv, and no .gitignore at all — the proposed .dev-media/ move plus the three-tier ignore is the right fix, but the migration from today's committed media/ needs an explicit `git rm -r --cached media/` step in the cutover, not just the new ignore rule.
- Give the queue/event registry a single directional rule in contracts/README (spec generates models; backend imports generated) and delete the 'mirrors backend, CI-checked to match' wording that implies the opposite.
- Add localized-catalog-content modeling (catalog schema) and a web i18n surface to match the India-first, multi-language premise and the iOS Localization module.

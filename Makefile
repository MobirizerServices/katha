# Katha monorepo — dev orchestration. Requires: uv (Python), node/npm (web), swift (iOS).
PYBIN := backend/.venv/bin/python
# Paths are relative to backend/ (every recipe cd's there first).
PP := packages/ledger:packages/domain:packages/infra:services/core-api

.PHONY: help setup test test-backend test-ios test-e2e api admin openapi gen-contracts seed-media web fmt clean

help:
	@echo "setup        create venv + install backend deps"
	@echo "test         run all verifiable tests (backend + iOS)"
	@echo "api          run core-api locally on :8799 (persist mode, shared DB)"
	@echo "admin        run admin-api on :8800 (OIDC dev IdP, shared DB)"
	@echo "test-e2e     Playwright money-path suite (system Chrome)"
	@echo "gen-contracts regenerate OpenAPI contracts + the client path inventory"
	@echo "openapi      regenerate contracts/openapi/core-api.json from the app"
	@echo "seed-media   regenerate the placeholder HLS dev catalog (gitignored)"
	@echo "test-ios     swift test the KathaKit package"

setup:
	cd backend && uv venv --python 3.12 .venv
	cd backend && uv pip install --python .venv/bin/python \
		"fastapi>=0.115" "uvicorn[standard]" "pydantic>=2" httpx \
		sqlalchemy aiosqlite "pyjwt>=2.9" "cryptography>=43" pytest pytest-cov

# All surfaces, each with an enforced coverage gate (98 lines / 95 branches).
test: test-backend test-web test-ios

# Backend tests WITH the coverage gate (fails under 98%). Config in backend/pytest.ini.
test-backend:
	cd backend && .venv/bin/python -m pytest

# Web coverage gates (Vitest thresholds in each vitest.config.ts).
test-web:
	cd web/site && npm run coverage
	cd web/admin && npm run coverage

# iOS coverage gate (swift test --enable-code-coverage + llvm-cov; fails < 98%).
test-ios:
	cd ios/KathaKit && ./coverage.sh

# Generate the app's Xcode project, build for the simulator, install and launch it.
# Needs core-api running (make api) for the feed/wallet to load.
ios-run:
	cd ios && ruby generate_xcodeproj.rb
	cd ios && xcodebuild -project KathaApp.xcodeproj -scheme KathaApp -sdk iphonesimulator \
		-configuration Debug -derivedDataPath build -destination 'generic/platform=iOS Simulator' build
	xcrun simctl boot "iPhone 17" || true
	xcrun simctl install booted ios/build/Build/Products/Debug-iphonesimulator/KathaApp.app
	xcrun simctl launch booted dev.katha.app

cov: test    # alias — every surface's run prints and gates its coverage

SHARED_ENV := KATHA_PERSIST=1 KATHA_DB_URL=sqlite+aiosqlite:////tmp/katha_shared.db

api:
	cd backend && $(SHARED_ENV) PYTHONPATH=$(PP) \
		.venv/bin/python -m uvicorn app.main:app --port 8799
	# NOTE: no --reload — restart after backend edits (matches how it is run in dev)

admin:
	cd backend && $(SHARED_ENV) KATHA_ADMIN_AUTH=oidc \
		PYTHONPATH="packages/domain:packages/ledger:packages/infra:services/admin-api:services/core-api" \
		.venv/bin/python -m uvicorn admin_app.main:app --port 8800

# Browser e2e for the admin money paths (#108): boots throwaway servers on
# isolated ports; uses the system Chrome, no browser download.
test-e2e:
	cd web/admin && npm run test:e2e

# Regenerate BOTH committed contracts + the client path inventory (#107).
# CI drift gates fail until this is run after any route change.
gen-contracts: openapi
	backend/.venv/bin/python tools/gen_admin_types.py

openapi:
	cd backend && PYTHONPATH=$(PP) .venv/bin/python -c \
		"import json; from app.main import app; open('../contracts/openapi/core-api.json','w').write(json.dumps(app.openapi(), indent=2))"
	@echo "wrote contracts/openapi/core-api.json"

seed-media:
	python3 tools/generate_placeholder_media.py

web:
	cd web/site && npm install && npm run dev

clean:
	rm -rf backend/.venv backend/**/__pycache__ ios/KathaKit/.build

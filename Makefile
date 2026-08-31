# Katha monorepo — dev orchestration. Requires: uv (Python), node/npm (web), swift (iOS).
PYBIN := backend/.venv/bin/python
PP := backend/packages/ledger:backend/packages/domain:backend/services/core-api

.PHONY: help setup test test-backend test-ios api openapi seed-media web fmt clean

help:
	@echo "setup        create venv + install backend deps"
	@echo "test         run all verifiable tests (backend + iOS)"
	@echo "api          run core-api locally on :8799"
	@echo "openapi      regenerate contracts/openapi/core-api.json from the app"
	@echo "seed-media   regenerate the placeholder HLS dev catalog (gitignored)"
	@echo "test-ios     swift test the KathaKit package"

setup:
	cd backend && uv venv --python 3.12 .venv
	cd backend && uv pip install --python .venv/bin/python \
		"fastapi>=0.115" "uvicorn[standard]" "pydantic>=2" httpx \
		sqlalchemy aiosqlite pyjwt pytest pytest-cov

# All surfaces, each with an enforced >=95% coverage gate.
test: test-backend test-web test-ios

# Backend tests WITH the coverage gate (fails under 95%). Config in backend/pytest.ini.
test-backend:
	cd backend && .venv/bin/python -m pytest

# Web coverage gates (Vitest thresholds in each vitest.config.ts; exit non-zero < 95%).
test-web:
	cd web/site && npm run coverage
	cd web/admin && npm run coverage

# iOS coverage gate (swift test --enable-code-coverage + llvm-cov; fails < 95%).
test-ios:
	cd ios/KathaKit && ./coverage.sh

cov: test    # alias — every surface's run prints and gates its coverage

api:
	cd backend && PYTHONPATH=$(PP:backend/%=%) .venv/bin/python -m uvicorn app.main:app --reload --port 8799

openapi:
	cd backend && PYTHONPATH=$(PP:backend/%=%) .venv/bin/python -c \
		"import json; from app.main import app; open('../contracts/openapi/core-api.json','w').write(json.dumps(app.openapi(), indent=2))"
	@echo "wrote contracts/openapi/core-api.json"

seed-media:
	python3 tools/generate_placeholder_media.py

web:
	cd web/site && npm install && npm run dev

clean:
	rm -rf backend/.venv backend/**/__pycache__ ios/KathaKit/.build

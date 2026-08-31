"""Make the workspace packages importable so `pytest` works from backend/ with no
external PYTHONPATH. Mirrors the deploy-time layout (each service on its own path)."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Order matters: both services ship a top-level `app` package, so core-api is
# inserted LAST (→ index 0) to own the `app` import; admin-api tests use `admin_app`.
for p in [
    "packages/ledger", "packages/domain", "packages/infra",
    "services/admin-api", "services/core-api",
]:
    sys.path.insert(0, str(ROOT / p))

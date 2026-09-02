"""Test setup: make the infra package importable even when the VERIFY PYTHONPATH
lists only ledger/domain/core-api (persistence is opt-in, so it isn't on that path
by default). The persistence test needs `katha_infra`, so add it here.

The cross-service tests also drive the admin app through its header-identity
path, which is now an explicit opt-in (runtime default is oidc — fail closed)."""
import os
import sys
from pathlib import Path

os.environ.setdefault("KATHA_ADMIN_AUTH", "headers")

_INFRA = Path(__file__).resolve().parents[3] / "packages" / "infra"
if str(_INFRA) not in sys.path:
    sys.path.insert(0, str(_INFRA))

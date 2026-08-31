"""Test setup: make the infra package importable even when the VERIFY PYTHONPATH
lists only ledger/domain/core-api (persistence is opt-in, so it isn't on that path
by default). The persistence test needs `katha_infra`, so add it here."""
import sys
from pathlib import Path

_INFRA = Path(__file__).resolve().parents[3] / "packages" / "infra"
if str(_INFRA) not in sys.path:
    sys.path.insert(0, str(_INFRA))

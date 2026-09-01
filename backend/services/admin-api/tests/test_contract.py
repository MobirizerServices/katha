"""#107 drift gate, server side: the committed OpenAPI contract must equal the
live app's schema. When a route changes, `tools/gen_admin_types.py` regenerates
the contract + the client path inventory — this test fails until it's run, so
the two can never drift silently."""
import json
from pathlib import Path

from admin_app.main import app

ROOT = Path(__file__).resolve().parents[4]


def test_committed_contract_matches_live_app():
    committed = json.loads(
        (ROOT / "contracts" / "openapi" / "admin-api.json").read_text())
    live = app.openapi()
    assert set(committed["paths"]) == set(live["paths"]), (
        "admin-api routes changed — run backend/.venv/bin/python "
        "tools/gen_admin_types.py and commit the result")
    for path, methods in live["paths"].items():
        assert set(committed["paths"][path]) == set(methods), path


def test_generated_ts_inventory_matches_live_app():
    ts = (ROOT / "web" / "admin" / "src" / "api" / "paths.generated.ts").read_text()
    live = {f'{m.upper()} {p}' for p, ms in app.openapi()["paths"].items() for m in ms}
    listed = {line.strip().strip('",')
              for line in ts.splitlines() if line.strip().startswith('"')}
    assert listed == live, (
        "paths.generated.ts is stale — run tools/gen_admin_types.py")

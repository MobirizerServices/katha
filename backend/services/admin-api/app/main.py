"""Deploy shim so the service runs as `uvicorn app.main:app`. The real
implementation lives in `admin_app` to avoid a top-level `app` package clash with
core-api on a shared PYTHONPATH. This module is never imported by the test run."""
from admin_app.main import app

__all__ = ["app"]

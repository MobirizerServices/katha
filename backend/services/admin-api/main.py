"""Legacy entrypoint kept for `uvicorn main:app`. Prefer `app.main:app`."""
from admin_app.main import app

__all__ = ["app"]

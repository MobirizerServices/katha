"""Test setup: the suite exercises the historical header-identity path, which
is now an explicit opt-in (the runtime default is oidc — fail closed). Tests
that cover oidc mode set KATHA_ADMIN_AUTH themselves via monkeypatch."""
import os

os.environ.setdefault("KATHA_ADMIN_AUTH", "headers")

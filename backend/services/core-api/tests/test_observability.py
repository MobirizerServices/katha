"""Observability init is safe and dependency-optional (P1-3)."""
import logging

from katha_infra import observability
from katha_infra.observability import _JsonFormatter


def test_init_noop_without_env(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    monkeypatch.delenv("KATHA_JSON_LOGS", raising=False)
    observability.init("core-api")     # no raise, no side effects


def test_init_sentry_dsn_without_lib_is_swallowed(monkeypatch):
    # sentry-sdk isn't in the dev venv; a set DSN must not crash the app.
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
    monkeypatch.delenv("KATHA_JSON_LOGS", raising=False)
    observability.init("core-api")


def test_json_logs_install_and_restore(monkeypatch):
    monkeypatch.setenv("KATHA_JSON_LOGS", "1")
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    root = logging.getLogger()
    saved = root.handlers[:]
    saved_level = root.level
    try:
        observability.init("core-api")
        assert any(isinstance(h.formatter, _JsonFormatter)
                   for h in root.handlers if h.formatter)
    finally:
        root.handlers[:] = saved
        root.setLevel(saved_level)


def test_json_formatter_shapes_a_record():
    f = _JsonFormatter()
    rec = logging.LogRecord("katha.test", logging.INFO, __file__, 1, "hi %s", ("x",), None)
    out = f.format(rec)
    assert '"level": "INFO"' in out and '"msg": "hi x"' in out

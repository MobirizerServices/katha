"""The fail-closed production config guard (katha_infra.prodguard)."""
import pytest

from katha_infra import InsecureConfigError, enforce_production_config as enforce

PG = "postgresql+asyncpg://katha:katha@db/katha"


def _managed_core(monkeypatch):
    monkeypatch.setenv("KATHA_ENV", "prod")
    monkeypatch.setenv("KATHA_JWT_SECRET", "a-real-long-random-jwt-secret")
    monkeypatch.setenv("KATHA_STREAM_SECRET", "a-real-random-stream-secret")
    monkeypatch.setenv("KATHA_CORS_ORIGINS", "https://app.katha.example")
    monkeypatch.setenv("KATHA_PERSIST", "1")
    monkeypatch.setenv("KATHA_DB_URL", PG)
    monkeypatch.setenv("KATHA_OTP_PROVIDER", "msg91")
    monkeypatch.setenv("KATHA_APPLE_BUNDLE_ID", "dev.katha.app")
    monkeypatch.setenv("KATHA_REDIS_URL", "redis://redis:6379/0")


def test_dev_env_is_a_noop(monkeypatch):
    monkeypatch.delenv("KATHA_ENV", raising=False)
    enforce("core-api")          # no raise
    enforce("admin-api")


def test_managed_core_missing_everything_raises(monkeypatch):
    monkeypatch.setenv("KATHA_ENV", "qa")
    for k in ("KATHA_JWT_SECRET", "KATHA_STREAM_SECRET", "KATHA_CORS_ORIGINS",
              "KATHA_PERSIST", "KATHA_DB_URL"):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(InsecureConfigError) as e:
        enforce("core-api")
    msg = str(e.value)
    assert "KATHA_JWT_SECRET" in msg and "KATHA_STREAM_SECRET" in msg
    assert "KATHA_PERSIST" in msg and "not a server database" not in msg


def test_managed_core_dev_default_secret_rejected(monkeypatch):
    _managed_core(monkeypatch)
    monkeypatch.setenv("KATHA_JWT_SECRET",
                       "dev-katha-secret-not-for-prod-please-override-in-env-0123456789")
    with pytest.raises(InsecureConfigError) as e:
        enforce("core-api")
    assert "still the committed dev default" in str(e.value)


def test_managed_core_dev_stubs_rejected(monkeypatch):
    _managed_core(monkeypatch)
    monkeypatch.setenv("KATHA_DEV_STUBS", "1")
    with pytest.raises(InsecureConfigError):
        enforce("core-api")


def test_managed_core_sqlite_rejected(monkeypatch):
    _managed_core(monkeypatch)
    monkeypatch.setenv("KATHA_DB_URL", "sqlite+aiosqlite:///./x.db")
    with pytest.raises(InsecureConfigError) as e:
        enforce("core-api")
    assert "server database" in str(e.value)


def test_managed_core_fully_configured_passes(monkeypatch):
    _managed_core(monkeypatch)
    monkeypatch.delenv("KATHA_DEV_STUBS", raising=False)
    enforce("core-api")          # no raise


def test_managed_admin_requires_oidc_and_session_secret(monkeypatch):
    monkeypatch.setenv("KATHA_ENV", "prod")
    monkeypatch.setenv("KATHA_PERSIST", "1")
    monkeypatch.setenv("KATHA_DB_URL", PG)
    monkeypatch.setenv("KATHA_ADMIN_SESSION_SECRET", "a-real-admin-session-secret")
    monkeypatch.setenv("KATHA_ADMIN_AUTH", "headers")
    with pytest.raises(InsecureConfigError) as e:
        enforce("admin-api")
    assert "KATHA_ADMIN_AUTH" in str(e.value)
    monkeypatch.setenv("KATHA_ADMIN_AUTH", "oidc")
    enforce("admin-api")         # no raise


def test_unknown_service_raises(monkeypatch):
    monkeypatch.setenv("KATHA_ENV", "prod")
    with pytest.raises(ValueError):
        enforce("nope")


# --- B3: login must be real in a managed env -------------------------------

def test_managed_core_requires_an_otp_provider(monkeypatch):
    _managed_core(monkeypatch)
    monkeypatch.delenv("KATHA_OTP_PROVIDER")
    with pytest.raises(InsecureConfigError) as e:
        enforce("core-api")
    assert "KATHA_OTP_PROVIDER" in str(e.value) and "any code" in str(e.value)
    monkeypatch.setenv("KATHA_OTP_PROVIDER", "console")
    with pytest.raises(InsecureConfigError) as e:
        enforce("core-api")
    assert "console" in str(e.value)


def test_managed_core_requires_apple_audience(monkeypatch):
    _managed_core(monkeypatch)
    monkeypatch.delenv("KATHA_APPLE_BUNDLE_ID")
    with pytest.raises(InsecureConfigError) as e:
        enforce("core-api")
    assert "KATHA_APPLE_BUNDLE_ID" in str(e.value)


def test_managed_core_requires_redis_unless_single_worker(monkeypatch):
    _managed_core(monkeypatch)
    monkeypatch.delenv("KATHA_REDIS_URL")
    with pytest.raises(InsecureConfigError) as e:
        enforce("core-api")
    assert "KATHA_REDIS_URL" in str(e.value)
    monkeypatch.setenv("KATHA_WORKERS", "1")
    enforce("core-api")          # a single worker may keep OTP state in memory

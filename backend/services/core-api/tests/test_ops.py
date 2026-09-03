"""Ops surfaces added for QA: /ready readiness and the X-Accel media offload."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_ready_in_memory_is_ready():
    r = client.get("/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["ready"] is True
    assert body["checks"]["db"] == "in-memory"


def test_ready_reports_redis_error_as_not_ready(monkeypatch):
    # Point at a dead Redis: readiness must flip to 503 so the LB drains us.
    monkeypatch.setenv("KATHA_REDIS_URL", "redis://127.0.0.1:1/0")
    r = client.get("/ready")
    assert r.status_code == 503
    assert r.json()["checks"]["redis"] == "error"


def test_media_xaccel_offloads_to_nginx(monkeypatch, tmp_path):
    base = tmp_path / "media"
    (base / "some-series").mkdir(parents=True)
    (base / "some-series" / "cover_9x16.jpg").write_bytes(b"jpeg-bytes")
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(base))
    monkeypatch.setenv("KATHA_XACCEL", "1")
    r = client.get("/media/some-series/cover_9x16.jpg")
    assert r.status_code == 200
    assert r.headers["X-Accel-Redirect"] == "/__media/some-series/cover_9x16.jpg"
    assert r.content == b""          # nginx streams the bytes, not Python

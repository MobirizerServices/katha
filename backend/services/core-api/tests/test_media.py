"""Cover URLs + the /media dev-CDN route + local-HLS playback switching."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.store import store
from katha_ledger import Ledger

client = TestClient(app)
AUTH = {"Authorization": "Bearer media-test-user"}


@pytest.fixture(autouse=True)
def reset_ledger():
    store.ledger = Ledger()
    yield


def test_series_carry_absolute_cover_urls():
    r = client.get("/v1/series")
    assert r.status_code == 200
    first = r.json()[0]
    assert first["cover_url"].startswith("http")
    assert f"/media/{first['slug']}/cover_9x16.jpg?v=" in first["cover_url"]
    assert f"/media/{first['slug']}/cover_16x9.jpg?v=" in first["cover_wide_url"]


def test_cover_urls_honour_media_base_env(monkeypatch):
    monkeypatch.setenv("KATHA_MEDIA_BASE", "https://cdn.example.com/")  # trailing / stripped
    r = client.get("/v1/home")
    s = r.json()["rows"][0]["series"][0]
    assert s["cover_url"].startswith(f"https://cdn.example.com/media/{s['slug']}/cover_9x16.jpg?v=")


def test_media_route_serves_files(monkeypatch, tmp_path):
    base = tmp_path / "media"
    (base / "some-series").mkdir(parents=True)
    (base / "some-series" / "cover_9x16.jpg").write_bytes(b"jpeg-bytes")
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(base))

    ok = client.get("/media/some-series/cover_9x16.jpg")
    assert ok.status_code == 200
    assert ok.content == b"jpeg-bytes"

    assert client.get("/media/some-series/missing.jpg").status_code == 404


def test_media_route_blocks_path_traversal(monkeypatch, tmp_path):
    base = tmp_path / "media"
    base.mkdir()
    (tmp_path / "secret.txt").write_text("nope")
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(base))
    # %2e%2e decodes to ".." after routing, so the resolved path escapes the base.
    assert client.get("/media/%2e%2e/secret.txt").status_code == 404


def test_playback_prefers_local_hls(monkeypatch, tmp_path):
    base = tmp_path / "media"
    hls = base / "kaanch-ka-mahal" / "e001" / "hls"
    hls.mkdir(parents=True)
    (hls / "master.m3u8").write_text("#EXTM3U")
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(base))

    r = client.post("/v1/series/kaanch-ka-mahal/episodes/1/playback", headers=AUTH)
    assert r.status_code == 200
    url = r.json()["hls_master_url"]
    assert "/media/kaanch-ka-mahal/e001/hls/master.m3u8" in url
    assert url.startswith("http")


def test_playback_falls_back_to_cdn_stub(monkeypatch, tmp_path):
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(tmp_path))  # no media on disk
    r = client.post("/v1/series/kaanch-ka-mahal/episodes/1/playback", headers=AUTH)
    assert "cdn.katha.dev" in r.json()["hls_master_url"]

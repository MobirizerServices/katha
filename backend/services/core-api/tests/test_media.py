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


def test_playback_streams_through_a_signed_token(monkeypatch, tmp_path):
    base = tmp_path / "media"
    hls = base / "kaanch-ka-mahal" / "e001" / "hls"
    (hls / "540p").mkdir(parents=True)
    (hls / "master.m3u8").write_text("#EXTM3U")
    (hls / "540p" / "seg_0001.ts").write_bytes(b"segment")
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(base))

    r = client.post("/v1/series/kaanch-ka-mahal/episodes/1/playback", headers=AUTH)
    assert r.status_code == 200
    url = r.json()["hls_master_url"]
    assert "/media/t/" in url and url.endswith("hls/master.m3u8")

    # The tokened tree serves the master AND its relative children.
    path = url.split("/media/", 1)[1]
    assert client.get(f"/media/{path}").status_code == 200
    token = path.split("/", 2)[1]
    seg = client.get(f"/media/t/{token}/kaanch-ka-mahal/e001/hls/540p/seg_0001.ts")
    assert seg.status_code == 200 and seg.content == b"segment"

    # A tampered token, someone else's episode, or a bare URL all refuse.
    assert client.get(f"/media/t/{token}x/kaanch-ka-mahal/e001/hls/master.m3u8").status_code == 403
    assert client.get(f"/media/t/{token}/other-series/e001/hls/master.m3u8").status_code == 403
    assert client.get("/media/kaanch-ka-mahal/e001/hls/master.m3u8").status_code == 403
    assert client.get("/media/kaanch-ka-mahal/e001/hls/540p/seg_0001.ts").status_code == 403


def test_stream_token_expires(monkeypatch, tmp_path):
    import time as _time
    from app import signing
    base = tmp_path / "media"
    hls = base / "kaanch-ka-mahal" / "e001" / "hls"
    hls.mkdir(parents=True)
    (hls / "master.m3u8").write_text("#EXTM3U")
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(base))

    token = signing.make_token("kaanch-ka-mahal/e001/hls/", "u_exp", ttl_s=60)
    assert client.get(f"/media/t/{token}/kaanch-ka-mahal/e001/hls/master.m3u8").status_code == 200
    real_now = _time.time
    monkeypatch.setattr(signing.time, "time", lambda: real_now() + 3600)
    assert client.get(f"/media/t/{token}/kaanch-ka-mahal/e001/hls/master.m3u8").status_code == 403
    assert not signing.check_token("not-a-token", "x")


def test_playback_resumes_where_the_viewer_left_off(monkeypatch, tmp_path):
    base = tmp_path / "media"
    hls = base / "kaanch-ka-mahal" / "e002" / "hls"
    hls.mkdir(parents=True)
    (hls / "master.m3u8").write_text("#EXTM3U")
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(base))

    hdr = {"Authorization": "Bearer resume-user"}
    client.put("/v1/progress", headers=hdr, json={"items": [
        {"slug": "kaanch-ka-mahal", "number": 2,
         "position_ms": 87000, "duration_ms": 300000}]})
    r = client.post("/v1/series/kaanch-ka-mahal/episodes/2/playback", headers=hdr)
    assert r.json()["resume_position_ms"] == 87000

    # Finished episodes restart from the top.
    client.put("/v1/progress", headers=hdr, json={"items": [
        {"slug": "kaanch-ka-mahal", "number": 2,
         "position_ms": 299000, "duration_ms": 300000}]})
    r = client.post("/v1/series/kaanch-ka-mahal/episodes/2/playback", headers=hdr)
    assert r.json()["resume_position_ms"] == 0


def test_playback_url_is_signed_even_without_media_on_disk(monkeypatch, tmp_path):
    """C7: never an unsigned CDN URL — the tokened route 404s a missing tree
    behind the same signature."""
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(tmp_path))  # no media on disk
    r = client.post("/v1/series/kaanch-ka-mahal/episodes/1/playback", headers=AUTH)
    url = r.json()["hls_master_url"]
    assert "/media/t/" in url and "cdn.katha.dev" not in url
    path = url.split("/media/t/", 1)[1]
    token, rest = path.split("/", 1)
    assert client.get(f"/media/t/{token}/{rest}").status_code == 404

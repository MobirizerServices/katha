"""Backend support for the new client screens: catalog + people search,
new-episode reminders, sign-out-everywhere, UI language on the profile,
real caption/audio tracks on playback, and a sized continue-watching list.

Each block covers the success path, validation, and the back-office serve
gate (an archived series is invisible everywhere)."""
import jwt
import pytest
from fastapi.testclient import TestClient

from app.auth import JWT_ALG, JWT_SECRET
from app.main import app
from app.store import store
from katha_infra import Database, SharedStore
from katha_ledger import Ledger

client = TestClient(app)
AUTH = {"Authorization": "Bearer screens-user"}


@pytest.fixture(autouse=True)
def reset_state():
    store.ledger = Ledger()
    store.engagement.pop("screens-user", None)
    store.users.pop("screens-user", None)
    yield


@pytest.fixture
def shared(tmp_path, monkeypatch):
    """A real shared store (KV + profiles) so the serve gate and token
    versions behave exactly as they do with KATHA_PERSIST=1."""
    sh = SharedStore(Database(f"sqlite+aiosqlite:///{tmp_path / 'screens.db'}"))
    monkeypatch.setattr(store, "shared", sh, raising=False)
    yield sh


# ---- 1. search ---------------------------------------------------------------

def test_search_requires_a_query_and_a_known_lang():
    assert client.get("/v1/search").status_code == 400
    assert client.get("/v1/search?q=%20%20").status_code == 400
    assert client.get("/v1/search?q=kaanch&lang=fr").status_code == 400


def test_search_matches_title_native_title_tropes_and_genres():
    r = client.get("/v1/search?q=KAANCH")
    assert r.status_code == 200
    body = r.json()
    assert body["query"] == "KAANCH"
    assert [s["slug"] for s in body["series"]] == ["kaanch-ka-mahal"]
    assert body["series"][0]["cover_url"].startswith("http")   # a full SeriesSummary

    native = client.get("/v1/search", params={"q": "காதல்"}).json()   # Kadhal Kanakku
    assert [s["slug"] for s in native["series"]] == ["kadhal-kanakku"]

    trope = client.get("/v1/search?q=contract marriage").json()
    assert {s["slug"] for s in trope["series"]} == {"ceo-sahab", "saat-pheron-ka-sauda"}

    genre = client.get("/v1/search?q=romance").json()
    assert {s["slug"] for s in genre["series"]} == {
        "ceo-sahab", "saat-pheron-ka-sauda", "kadhal-kanakku", "prema-pariksha"}


def test_search_ranks_title_hits_before_trope_hits_and_filters_by_lang():
    # "sauda" is in two titles; "hidden identity" is a trope on several others.
    r = client.get("/v1/search?q=sauda").json()
    assert [s["slug"] for s in r["series"]] == ["saat-pheron-ka-sauda", "nizam-ka-sauda"]
    ta = client.get("/v1/search?q=romance&lang=ta").json()
    assert [s["slug"] for s in ta["series"]] == ["kadhal-kanakku"]
    assert all(s["primary_language"] == "ta" for s in ta["series"])


def test_search_people_come_from_the_cast_once_each_with_all_their_series():
    r = client.get("/v1/search?q=rawal").json()
    assert r["series"] == []
    assert r["people"] == [{
        "name": "Aditi Rawal", "role": "Lead",
        "series": [s for s in r["people"][0]["series"]],
    }]
    assert [s["slug"] for s in r["people"][0]["series"]] == ["kaanch-ka-mahal"]

    # A broad needle lists every matching person exactly once.
    r = client.get("/v1/search?q=an").json()
    names = [p["name"] for p in r["people"]]
    assert len(names) == len(set(names)) and "Naveen Chandran" in names
    for p in r["people"]:
        assert p["role"] in ("Lead", "Support", "Antagonist") and p["series"]


def test_search_honours_the_serve_gate_for_series_and_people(shared):
    shared.kv_set("status:kaanch-ka-mahal", "archived")
    r = client.get("/v1/search?q=kaanch").json()
    assert r["series"] == []
    assert client.get("/v1/search?q=rawal").json()["people"] == []
    # A panel draft (no cast) is searchable once live, by its title.
    shared.kv_set("series:draft-thing", '{"title": "Draft Thing", "episode_count": 3}')
    r = client.get("/v1/search?q=draft thing").json()
    assert [s["slug"] for s in r["series"]] == ["draft-thing"] and r["people"] == []


def test_series_detail_carries_cast_and_native_title():
    d = client.get("/v1/series/kaanch-ka-mahal").json()
    assert d["title_native"] == "काँच का महल"
    assert d["cast"][0] == {"name": "Aditi Rawal", "role": "Lead"}
    assert 2 <= len(d["cast"]) <= 4


# ---- 2. reminders -----------------------------------------------------------

def test_reminders_add_readd_remove_and_unknown_404():
    assert client.get("/v1/me/reminders", headers=AUTH).json() == {"slugs": []}
    assert client.put("/v1/me/reminders/kaanch-ka-mahal", headers=AUTH).json()["slugs"] == ["kaanch-ka-mahal"]
    client.put("/v1/me/reminders/ceo-sahab", headers=AUTH)
    r = client.put("/v1/me/reminders/kaanch-ka-mahal", headers=AUTH)   # re-add -> front, once
    assert r.json()["slugs"] == ["kaanch-ka-mahal", "ceo-sahab"]
    assert client.get("/v1/me/reminders", headers=AUTH).json()["slugs"] == ["kaanch-ka-mahal", "ceo-sahab"]
    assert client.delete("/v1/me/reminders/ceo-sahab", headers=AUTH).json()["slugs"] == ["kaanch-ka-mahal"]
    assert client.delete("/v1/me/reminders/never-set", headers=AUTH).status_code == 200
    assert client.put("/v1/me/reminders/not-real", headers=AUTH).status_code == 404
    assert client.get("/v1/me/reminders").status_code == 200   # dev guest, no header


def test_reminders_honour_the_serve_gate(shared):
    shared.kv_set("status:kaanch-ka-mahal", "archived")
    assert client.put("/v1/me/reminders/kaanch-ka-mahal", headers=AUTH).status_code == 404
    shared.kv_set("status:kaanch-ka-mahal", "live")
    assert client.put("/v1/me/reminders/kaanch-ka-mahal", headers=AUTH).status_code == 200


def test_reminders_follow_the_guest_into_the_member_account():
    guest = client.post("/v1/auth/guest").json()
    gh = {"Authorization": f"Bearer {guest['access_token']}"}
    client.put("/v1/me/reminders/vetri-vaasal", headers=gh)
    client.put("/v1/me/list/vetri-vaasal", headers=gh)
    member = client.post("/v1/auth/otp/verify", headers=gh,
                         json={"phone": "+919000000777", "code": "1234"}).json()
    mh = {"Authorization": f"Bearer {member['access_token']}"}
    assert client.get("/v1/me/reminders", headers=mh).json()["slugs"] == ["vetri-vaasal"]
    assert client.get("/v1/me/list", headers=mh).json()["slugs"] == ["vetri-vaasal"]


# ---- 3. sign out other devices ----------------------------------------------

def test_signout_devices_without_persistence_returns_a_fresh_token():
    r = client.post("/v1/me/signout-devices", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    claims = jwt.decode(body["access_token"], JWT_SECRET, algorithms=[JWT_ALG])
    assert claims["sub"] == "screens-user" and claims["ver"] == 0
    assert body["user"]["user_id"] == "screens-user"
    # nothing to bump in-memory: the old bearer keeps working
    assert client.get("/v1/me", headers=AUTH).status_code == 200


def test_signout_devices_kills_other_tokens_and_keeps_this_one(shared):
    first = client.post("/v1/auth/guest").json()
    old = {"Authorization": f"Bearer {first['access_token']}"}
    uid = first["user"]["user_id"]
    assert client.get("/v1/me", headers=old).status_code == 200

    r = client.post("/v1/me/signout-devices", headers=old)
    assert r.status_code == 200
    fresh = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert r.json()["user"]["user_id"] == uid
    assert shared.token_version(uid) == 1
    assert jwt.decode(r.json()["access_token"], JWT_SECRET, algorithms=[JWT_ALG])["ver"] == 1

    assert client.get("/v1/me", headers=old).status_code == 401      # every other device
    assert client.get("/v1/me", headers=fresh).status_code == 200    # this one


# ---- 4. ui_language ----------------------------------------------------------

def test_ui_language_defaults_to_en_and_validates():
    assert client.get("/v1/me", headers=AUTH).json()["ui_language"] == "en"
    r = client.patch("/v1/me", headers=AUTH, json={"ui_language": "hi"})
    assert r.status_code == 200 and r.json()["ui_language"] == "hi"
    assert client.get("/v1/me", headers=AUTH).json()["ui_language"] == "hi"
    assert client.patch("/v1/me", headers=AUTH, json={"ui_language": "fr"}).status_code == 400
    assert client.get("/v1/me", headers=AUTH).json()["ui_language"] == "hi"   # unchanged
    # the auth token payload carries it too
    assert client.post("/v1/auth/guest").json()["user"]["ui_language"] == "en"


def test_content_language_patch_reaches_the_shared_profile(shared):
    client.patch("/v1/me", headers=AUTH, json={"language": "ta", "ui_language": "hi"})
    row = next(u for u in shared.list_users() if u["user_id"] == "screens-user")
    assert row["language"] == "ta"        # persisted; ui_language is projection-only


# ---- 5. playback tracks ------------------------------------------------------

def test_playback_lists_captions_on_disk_under_the_stream_token(monkeypatch, tmp_path):
    base = tmp_path / "media"
    ep = base / "kaanch-ka-mahal" / "e001"
    (ep / "hls").mkdir(parents=True)
    (ep / "hls" / "master.m3u8").write_text("#EXTM3U")
    (ep / "subs").mkdir()
    (ep / "subs" / "en.vtt").write_text("WEBVTT\n\n00:00.000 --> 00:01.000\nhello\n")
    (ep / "subs" / "hi.vtt").write_text("WEBVTT\n")
    (ep / "subs" / "xx.vtt").write_text("WEBVTT\n")
    (ep / "subs" / "notes.txt").write_text("ignored")
    (base / "kaanch-ka-mahal" / "e002" / "subs").mkdir(parents=True)
    (base / "kaanch-ka-mahal" / "e002" / "subs" / "en.vtt").write_text("WEBVTT\n")
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(base))

    r = client.post("/v1/series/kaanch-ka-mahal/episodes/1/playback", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["audio"] == [{"lang": "hi", "label": "Hindi", "kind": "original"}]
    assert [(c["lang"], c["label"]) for c in body["captions"]] == [
        ("en", "English"), ("hi", "Hindi"), ("xx", "XX")]
    en = body["captions"][0]["url"]
    assert "/media/t/" in en and en.endswith("/kaanch-ka-mahal/e001/subs/en.vtt")

    # Same token root as the HLS master, and both are fetchable through it.
    hls_path = body["hls_master_url"].split("/media/", 1)[1]
    sub_path = en.split("/media/", 1)[1]
    assert hls_path.split("/", 2)[1] == sub_path.split("/", 2)[1]
    assert client.get(f"/media/{hls_path}").status_code == 200
    got = client.get(f"/media/{sub_path}")
    assert got.status_code == 200 and got.text.startswith("WEBVTT")
    # ...but the token is scoped to THIS episode's directory.
    token = sub_path.split("/", 2)[1]
    assert client.get(f"/media/t/{token}/kaanch-ka-mahal/e002/subs/en.vtt").status_code == 403
    assert client.get(f"/media/t/{token}/kaanch-ka-mahal/e001/../e002/subs/en.vtt").status_code == 403


def test_playback_captions_empty_when_no_subs_on_disk(monkeypatch, tmp_path):
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(tmp_path))
    body = client.post("/v1/series/vetri-vaasal/episodes/1/playback", headers=AUTH).json()
    assert body["captions"] == []
    assert body["audio"] == [{"lang": "ta", "label": "Tamil", "kind": "original"}]


# ---- 6. continue watching ----------------------------------------------------

def test_continue_limit_and_full_list_fields():
    items = [{"slug": s, "number": n, "position_ms": 5000, "duration_ms": 60000}
             for s, n in [("kaanch-ka-mahal", 3), ("ceo-sahab", 1), ("vetri-vaasal", 2)]]
    client.put("/v1/progress", headers=AUTH, json={"items": items})
    full = client.get("/v1/me/continue", headers=AUTH).json()["items"]
    assert [i["slug"] for i in full] == ["vetri-vaasal", "ceo-sahab", "kaanch-ka-mahal"]
    kkm = full[-1]
    assert kkm["title"] == kkm["series_title"] == "Kaanch Ka Mahal"
    assert kkm["episode_title"] == "The torn corners" and kkm["percent"] == 8
    assert kkm["cover_url"].startswith("http") and "/cover_9x16.jpg" in kkm["cover_url"]
    assert "/cover_16x9.jpg" in kkm["cover_wide_url"]
    assert kkm["updated_at"].startswith("20")

    two = client.get("/v1/me/continue?limit=2", headers=AUTH).json()["items"]
    assert [i["slug"] for i in two] == ["vetri-vaasal", "ceo-sahab"]
    assert client.get("/v1/me/continue?limit=0", headers=AUTH).status_code == 422
    assert client.get("/v1/me/continue?limit=101", headers=AUTH).status_code == 422


def test_continue_survives_a_series_that_is_no_longer_in_the_catalog():
    store.record_progress("screens-user", "vanished", 1, 1000, 60000)
    item = client.get("/v1/me/continue", headers=AUTH).json()["items"][0]
    assert item["slug"] == item["title"] == "vanished" and item["cover_url"] == ""

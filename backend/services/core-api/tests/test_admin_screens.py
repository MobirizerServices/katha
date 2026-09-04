"""Back-office views, wave 2 — Media & QC, Moderation queue, Localization,
Writers' Room, Programming calendar, bulk pricing — driven end to end through
admin-api against one temp shared DB (the `shared` fixture pattern from
test_admin_platform.py), plus the fail-closed paths when persistence is off.
"""
import json as _json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import admin_app.main as admin_main
from admin_app.store import store as admin_store
from app.store import store as core_store
from katha_infra import Database, SharedStore
from katha_ledger import Ledger

admin = TestClient(admin_main.app)

ADMIN = {"X-Actor-Id": "riya", "X-Role": "admin"}
CONTENT = {"X-Actor-Id": "nikhil", "X-Role": "content"}
QC = {"X-Actor-Id": "dev", "X-Role": "qc"}
FINANCE = {"X-Actor-Id": "farah", "X-Role": "finance"}
SUPPORT = {"X-Actor-Id": "sam", "X-Role": "support"}
RO = {"X-Actor-Id": "obs", "X-Role": "ro"}
SLUG = "kaanch-ka-mahal"            # 60 episodes in the seed catalog
T0 = "2026-09-01T00:00:00+00:00"


@pytest.fixture
def shared(tmp_path, monkeypatch):
    db = Database(f"sqlite+aiosqlite:///{tmp_path/'screens.db'}")
    sh = SharedStore(db)
    monkeypatch.setattr(admin_main, "SHARED", sh)
    monkeypatch.setattr(core_store, "shared", sh, raising=False)
    monkeypatch.setenv("KATHA_MEDIA_DIR", str(tmp_path / "media"))
    admin_store.ledger = Ledger()
    admin_store.audit.clear()
    admin_store.approvals.clear()
    admin_store.flag_overrides.clear()
    core_store.ledger = Ledger()
    yield sh
    monkeypatch.setattr(core_store, "shared", None, raising=False)


def _audit_actions(sh):
    return [r["action"] for r in sh.audit_list(limit=100)["rows"]]


# ---- helpers ------------------------------------------------------------------

def test_kv_json_helpers_tolerate_bad_rows(shared):
    shared.kv_set("loc:x", "not json")
    shared.kv_set("loc:y", "[1, 2]")
    shared.kv_set("loc:z", '{"ok": true}')
    assert admin_main._kv_json("loc:x") == {}
    assert admin_main._kv_json("loc:y") == {}
    assert admin_main._kv_json("loc:missing") == {}
    assert admin_main._kv_json("loc:z") == {"ok": True}
    assert admin_main._kv_json_prefix("loc:") == {"z": {"ok": True}}


def test_helpers_without_persistence():
    assert admin_main._kv_json("anything") == {}
    assert admin_main._kv_json_prefix("anything:") == {}
    assert admin_main._moderation_items() == []


# ---- 1. Media & QC ------------------------------------------------------------

def test_media_qc_board_and_verdicts(shared, tmp_path):
    hls = tmp_path / "media" / SLUG / "e001" / "hls"
    hls.mkdir(parents=True)
    (hls / "master.m3u8").write_text("#EXTM3U")

    board = admin.get("/admin/v1/media/qc", headers=RO).json()
    row = next(s for s in board["series"] if s["slug"] == SLUG)
    assert row["episodeCount"] == 60
    assert row["episodes_with_media"] == 1 and row["episodes_missing"] == 59
    assert row["qc"] == {"pending": 60, "passed": 0, "failed": 0}
    assert row["episodes"][0]["hasMedia"] is True
    assert row["episodes"][1]["hasMedia"] is False
    assert row["episodes"][0]["qc"]["status"] == "pending"

    # pass without a note is fine; fail needs one
    ok = admin.patch(f"/admin/v1/media/qc/{SLUG}/1", headers=QC, json={"status": "passed"})
    assert ok.status_code == 200 and ok.json()["qc"]["by"] == "dev"
    assert admin.patch(f"/admin/v1/media/qc/{SLUG}/2", headers=QC,
                       json={"status": "failed"}).status_code == 400
    bad = admin.patch(f"/admin/v1/media/qc/{SLUG}/2", headers=CONTENT,
                      json={"status": "failed", "note": "audio drops at 00:41"})
    assert bad.status_code == 200 and bad.json()["qc"]["note"] == "audio drops at 00:41"

    assert admin.patch(f"/admin/v1/media/qc/{SLUG}/3", headers=QC,
                       json={"status": "meh"}).status_code == 400
    assert admin.patch(f"/admin/v1/media/qc/{SLUG}/3", headers=QC,
                       json={"status": "passed", "note": "x" * 301}).status_code == 400
    assert admin.patch(f"/admin/v1/media/qc/{SLUG}/999", headers=QC,
                       json={"status": "passed"}).status_code == 404
    assert admin.patch("/admin/v1/media/qc/nope/1", headers=QC,
                       json={"status": "passed"}).status_code == 404
    assert admin.patch(f"/admin/v1/media/qc/{SLUG}/1", headers=SUPPORT,
                       json={"status": "passed"}).status_code == 403

    # a corrupt verdict row reads as pending
    shared.kv_set(f"qc:{SLUG}:4", "{broken")
    shared.kv_set(f"qc:{SLUG}:5", '{"status": "bogus"}')
    board = admin.get("/admin/v1/media/qc", headers=QC).json()
    row = next(s for s in board["series"] if s["slug"] == SLUG)
    assert row["qc"] == {"pending": 58, "passed": 1, "failed": 1}
    assert row["episodes"][1]["qc"]["status"] == "failed"
    assert row["episodes"][4]["qc"]["status"] == "pending"
    assert _audit_actions(shared).count("media.qc") == 2


# ---- 2. Moderation & ratings queue ----------------------------------------------

def test_moderation_queue_and_review(shared):
    # (a) a fresh rating decision through the accountable endpoint
    r = admin.patch(f"/admin/v1/catalog/series/{SLUG}/rating", headers=QC,
                    json={"rating": "U/A 16+", "reason": "episode 41"})
    assert r.status_code == 200
    # old, naive and unparseable rating stamps are NOT in the 30-day window
    old = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
    shared.kv_set("rating:ceo-sahab", _json.dumps({"value": "A", "at": old, "by": "x"}))
    shared.kv_set("rating:dilli-6-ka-raaz",
                  _json.dumps({"value": "A", "at": "2026-09-01T00:00:00", "by": "x"}))
    shared.kv_set("rating:saat-pheron-ka-sauda", _json.dumps({"value": "A", "at": "soon"}))
    # (b) grievances: one about content, one about money
    shared.grievance_create(gid="G-1", user_id="u1", contact="a@b.c", channel="app",
                            subject="Vulgar scene in episode 3", body="not for minors",
                            created_at=T0)
    shared.grievance_create(gid="G-2", user_id="u2", contact="a@b.c", channel="app",
                            subject="coins missing", body="paid, no coins",
                            created_at=T0)

    q = admin.get("/admin/v1/moderation", headers=QC).json()
    ids = [i["id"] for i in q["items"]]
    assert ids == [f"rating:{SLUG}", "grievance:G-1"]          # newest first
    assert q["open"] == 2
    rating = q["items"][0]
    assert rating["kind"] == "rating" and rating["rating"] == "U/A 16+"
    assert rating["title"] == "Kaanch Ka Mahal" and rating["to"] == f"/catalog/{SLUG}"
    g = q["items"][1]
    assert g["kind"] == "grievance" and g["status"] == "new" and "contact" not in g

    # review it — once
    r = admin.post("/admin/v1/moderation/grievance:G-1/reviewed", headers=CONTENT,
                   json={"note": "takedown not needed"})
    assert r.status_code == 200 and r.json()["reviewed"]["by"] == "nikhil"
    assert admin.post("/admin/v1/moderation/grievance:G-1/reviewed",
                      headers=QC).status_code == 409
    assert admin.post("/admin/v1/moderation/nope/reviewed", headers=QC).status_code == 404
    assert admin.post("/admin/v1/moderation/rating:x/reviewed", headers=QC,
                      json={"note": "x" * 301}).status_code == 400
    assert admin.get("/admin/v1/moderation", headers=SUPPORT).status_code == 403

    q = admin.get("/admin/v1/moderation", headers=QC).json()
    assert q["open"] == 1
    assert [i["id"] for i in q["items"]] == [f"rating:{SLUG}", "grievance:G-1"]
    assert q["items"][1]["reviewed"]["note"] == "takedown not needed"
    assert "moderation.reviewed" in _audit_actions(shared)


# ---- 3. Localization ---------------------------------------------------------------

def test_localization_matrix_and_cell_edit(shared):
    board = admin.get("/admin/v1/localization", headers=RO).json()
    assert board["languages"] == ["hi", "ta", "te"] and board["kinds"] == ["dub", "sub"]
    row = next(s for s in board["series"] if s["slug"] == SLUG)
    assert row["language"] == "Hindi" and row["primary"] == "hi"
    assert row["langs"]["ta"]["dub"]["status"] == "none"

    r = admin.patch(f"/admin/v1/localization/{SLUG}", headers=CONTENT,
                    json={"lang": "ta", "kind": "dub", "status": "in_progress",
                          "owner": "Priya", "due": "2026-10-01"})
    assert r.status_code == 200
    assert r.json()["langs"]["ta"]["dub"] == {
        "status": "in_progress", "owner": "Priya", "due": "2026-10-01",
        "by": "nikhil", "at": r.json()["at"]}
    # a second cell in the same language keeps the first
    admin.patch(f"/admin/v1/localization/{SLUG}", headers=CONTENT,
                json={"lang": "ta", "kind": "sub", "status": "done"})
    langs = admin.get("/admin/v1/localization", headers=QC).json()
    row = next(s for s in langs["series"] if s["slug"] == SLUG)["langs"]
    assert row["ta"]["dub"]["status"] == "in_progress" and row["ta"]["sub"]["status"] == "done"
    assert row["hi"]["sub"]["status"] == "none"

    bad = [{"lang": "fr", "kind": "dub", "status": "done"},
           {"lang": "hi", "kind": "voice", "status": "done"},
           {"lang": "hi", "kind": "dub", "status": "later"},
           {"lang": "hi", "kind": "dub", "status": "done", "due": "next week"},
           {"lang": "hi", "kind": "dub", "status": "done", "owner": 42}]
    for body in bad:
        assert admin.patch(f"/admin/v1/localization/{SLUG}", headers=CONTENT,
                           json=body).status_code == 400, body
    assert admin.patch("/admin/v1/localization/nope", headers=CONTENT,
                       json=bad[0]).status_code == 404
    assert admin.patch(f"/admin/v1/localization/{SLUG}", headers=QC,
                       json={"lang": "hi", "kind": "dub", "status": "done"}).status_code == 403

    # corrupt shapes read as defaults, and an edit over them heals the row
    shared.kv_set("loc:ceo-sahab", _json.dumps({"hi": "junk", "ta": {"dub": "junk"}}))
    langs = admin.get("/admin/v1/localization", headers=QC).json()
    row = next(s for s in langs["series"] if s["slug"] == "ceo-sahab")["langs"]
    assert row["hi"]["dub"]["status"] == "none" and row["ta"]["dub"]["status"] == "none"
    r = admin.patch("/admin/v1/localization/ceo-sahab", headers=CONTENT,
                    json={"lang": "hi", "kind": "sub", "status": "done"})
    assert r.json()["langs"]["hi"]["sub"]["status"] == "done"
    assert _audit_actions(shared).count("series.localization") == 3


# ---- 4. Writers' Room -------------------------------------------------------------

def test_writers_room_workspace(shared):
    idx = admin.get("/admin/v1/writers", headers=RO).json()["series"]
    assert len(idx) == 14 and all(r["completeness_pct"] == 0 for r in idx)

    ws = admin.get(f"/admin/v1/writers/{SLUG}", headers=QC).json()
    assert ws["title"] == "Kaanch Ka Mahal" and ws["hooks"] == [] and ws["logline"] == ""
    assert admin.get("/admin/v1/writers/nope", headers=QC).status_code == 404

    body = {"logline": "A glass palace hides a murder.",
            "hooks": ["Who broke the mirror?", "", "   "],
            "episode_outlines": [{"number": n, "beat": f"beat {n}"} for n in range(1, 31)],
            "notes": "keep Meera sympathetic"}
    r = admin.put(f"/admin/v1/writers/{SLUG}", headers=CONTENT, json=body)
    assert r.status_code == 200
    saved = r.json()
    assert saved["hooks"] == ["Who broke the mirror?"]           # blanks dropped
    assert len(saved["episode_outlines"]) == 30
    assert saved["completeness_pct"] == 25 + 25 + 25              # half the outline
    assert saved["by"] == "nikhil"

    idx = admin.get("/admin/v1/writers", headers=CONTENT).json()["series"]
    assert idx[0]["slug"] == SLUG and idx[0]["completeness_pct"] == 75
    assert idx[0]["hooks"] == 1 and idx[0]["outlines"] == 30

    bad = [{"hooks": "one"},
           {"hooks": ["x"] * 201},
           {"episode_outlines": "no"},
           {"episode_outlines": [{"number": 1}] * 201},
           {"episode_outlines": ["free text"]},
           {"episode_outlines": [{"number": "one", "beat": "b"}]},
           {"episode_outlines": [{"number": 61, "beat": "b"}]},
           {"episode_outlines": [{"number": 1, "beat": "b" * 2001}]},
           {"logline": 7},
           {"notes": "n" * 2001}]
    for b in bad:
        assert admin.put(f"/admin/v1/writers/{SLUG}", headers=CONTENT,
                         json=b).status_code == 400, b
    assert admin.put("/admin/v1/writers/nope", headers=CONTENT, json={}).status_code == 404
    assert admin.put(f"/admin/v1/writers/{SLUG}", headers=QC, json={}).status_code == 403

    # a hand-corrupted workspace reads as empty lists, never a 500
    shared.kv_set("writers:ceo-sahab",
                  _json.dumps({"hooks": "x", "episode_outlines": [1, {"number": 2}]}))
    ws = admin.get("/admin/v1/writers/ceo-sahab", headers=QC).json()
    assert ws["hooks"] == [] and ws["episode_outlines"] == [{"number": 2}]
    shared.kv_set("writers:dilli-6-ka-raaz", _json.dumps({"episode_outlines": "x"}))
    assert admin.get("/admin/v1/writers/dilli-6-ka-raaz",
                     headers=QC).json()["episode_outlines"] == []
    assert "writers.save" in _audit_actions(shared)


# ---- 5. Programming -----------------------------------------------------------------

def test_programming_schedule_lifecycle(shared):
    cal = admin.get("/admin/v1/programming", headers=RO).json()
    assert len(cal["series"]) == 14
    assert all(r["release_at"] == "" and r["status"] == "live" for r in cal["series"])

    # confirm + validation
    assert admin.patch(f"/admin/v1/catalog/series/{SLUG}/schedule", headers=CONTENT,
                       json={"release_at": "2026-09-20T14:30:00+00:00"}).status_code == 428
    assert admin.patch("/admin/v1/catalog/series/nope/schedule", headers=CONTENT,
                       json={"confirm": "nope"}).status_code == 404
    for bad in ("next thursday", "2026-09-20T14:30:00"):
        assert admin.patch(f"/admin/v1/catalog/series/{SLUG}/schedule", headers=CONTENT,
                           json={"release_at": bad, "confirm": SLUG}).status_code == 400
    assert admin.patch(f"/admin/v1/catalog/series/{SLUG}/schedule", headers=QC,
                       json={"release_at": "", "confirm": SLUG}).status_code == 403

    r = admin.patch(f"/admin/v1/catalog/series/{SLUG}/schedule", headers=CONTENT,
                    json={"release_at": "2026-09-20T20:00:00+05:30", "confirm": SLUG})
    assert r.status_code == 200
    assert r.json()["status"] == "scheduled"
    assert r.json()["release_at"] == "2026-09-20T20:00:00+05:30"
    detail = admin.get(f"/admin/v1/catalog/series/{SLUG}", headers=ADMIN).json()
    assert detail["status"] == "scheduled"                         # via the status rule
    cal = admin.get("/admin/v1/programming", headers=CONTENT).json()["series"]
    assert cal[0]["slug"] == SLUG and cal[0]["scheduled_by"] == "nikhil"
    assert cal[1]["release_at"] == ""

    # unschedule: scheduled → draft
    r = admin.patch(f"/admin/v1/catalog/series/{SLUG}/schedule", headers=CONTENT,
                    json={"release_at": "", "confirm": SLUG})
    assert r.json() == {"slug": SLUG, "status": "draft", "release_at": ""}
    assert admin.get(f"/admin/v1/catalog/series/{SLUG}", headers=ADMIN).json()["status"] == "draft"
    # unscheduling a live series leaves it live
    admin.post(f"/admin/v1/catalog/series/{SLUG}/status", headers=CONTENT,
               json={"status": "live"})
    r = admin.patch(f"/admin/v1/catalog/series/{SLUG}/schedule", headers=CONTENT,
                    json={"confirm": SLUG})
    assert r.json()["status"] == "live"
    actions = _audit_actions(shared)
    assert actions.count("series.schedule") == 1
    assert actions.count("series.unschedule") == 2


# ---- 9. Bulk pricing --------------------------------------------------------------

def test_bulk_pricing_validates_applies_and_audits_once(shared):
    base = "/admin/v1/catalog/pricing/bulk"
    assert admin.post(base, headers=FINANCE,
                      json={"slugs": [SLUG], "coin_price": 20}).status_code == 428
    for bad in ({"slugs": [], "coin_price": 20},
                {"slugs": "x", "coin_price": 20},
                {"slugs": ["s"] * 101, "coin_price": 20},
                {"slugs": [SLUG], "coin_price": 0},
                {"slugs": [SLUG], "free_episodes": 101},
                {"slugs": [SLUG], "coin_price": "ten"},
                {"slugs": [SLUG]}):
        assert admin.post(base, headers=FINANCE,
                          json={**bad, "confirm": "PRICING"}).status_code == 400, bad
    assert admin.post(base, headers=CONTENT,
                      json={"slugs": [SLUG], "coin_price": 20,
                            "confirm": "PRICING"}).status_code == 403

    r = admin.post(base, headers=FINANCE,
                   json={"slugs": [SLUG, "ceo-sahab", SLUG, "nope"], "coin_price": 20,
                         "free_episodes": 5, "confirm": "PRICING"})
    assert r.status_code == 200
    body = r.json()
    assert body["applied"] == 2 and body["coin_price"] == 20
    assert body["results"] == [
        {"slug": SLUG, "ok": True, "coin_price": 20, "free_episodes": 5},
        {"slug": "ceo-sahab", "ok": True, "coin_price": 20, "free_episodes": 5},
        {"slug": "nope", "ok": False, "error": "series not found"}]
    detail = admin.get(f"/admin/v1/catalog/series/{SLUG}", headers=ADMIN).json()
    assert detail["coinPrice"] == 20 and detail["freeEpisodes"] == 5
    assert detail["pricingOverridden"] is True
    rows = shared.audit_list(limit=100)["rows"]
    bulk = [x for x in rows if x["action"] == "series.pricing.bulk"]
    assert len(bulk) == 1
    assert bulk[0]["entity"] == "2 series"
    assert f"slugs={SLUG},ceo-sahab" in bulk[0]["change"]

    # nothing applied → nothing audited
    r = admin.post(base, headers=FINANCE,
                   json={"slugs": ["nope"], "coin_price": 20, "confirm": "PRICING"})
    assert r.json()["applied"] == 0
    assert _audit_actions(shared).count("series.pricing.bulk") == 1

    # the single lever shares the bounds (a non-integer is a 400, not a 500)
    assert admin.patch(f"/admin/v1/catalog/series/{SLUG}/pricing", headers=FINANCE,
                       json={"coin_price": "x", "confirm": SLUG}).status_code == 400


def test_analytics_open_to_qc_and_matrix_lists_new_capabilities(shared):
    assert admin.get("/admin/v1/analytics", headers=QC).status_code == 200
    caps = {m["capability"]: m for m in
            admin.get("/admin/v1/access/matrix", headers=QC).json()["matrix"]}
    assert caps["Media QC verdicts"]["roles"] == ["admin", "content", "qc"]
    assert caps["Bulk pricing"]["roles"] == ["admin", "finance"]
    assert caps["Components (internal)"]["roles"] == ["admin"]


# ---- persistence off: reads are honest defaults, writes fail closed -----------

def test_wave2_without_persistence_reads_and_503s():
    assert admin_main.SHARED is None
    board = admin.get("/admin/v1/media/qc", headers=QC).json()
    assert len(board["series"]) == 14
    assert admin.get("/admin/v1/moderation", headers=QC).json() == {"items": [], "open": 0}
    loc = admin.get("/admin/v1/localization", headers=QC).json()["series"][0]["langs"]
    assert loc["hi"]["dub"]["status"] == "none"
    assert admin.get("/admin/v1/writers", headers=QC).json()["series"][0]["completeness_pct"] == 0
    assert admin.get(f"/admin/v1/writers/{SLUG}", headers=QC).json()["hooks"] == []
    assert admin.get("/admin/v1/programming", headers=QC).json()["series"][0]["release_at"] == ""

    assert admin.patch(f"/admin/v1/media/qc/{SLUG}/1", headers=QC,
                       json={"status": "passed"}).status_code == 503
    assert admin.post("/admin/v1/moderation/x/reviewed", headers=QC).status_code == 503
    assert admin.patch(f"/admin/v1/localization/{SLUG}", headers=CONTENT,
                       json={"lang": "hi", "kind": "dub", "status": "done"}).status_code == 503
    assert admin.put(f"/admin/v1/writers/{SLUG}", headers=CONTENT, json={}).status_code == 503
    assert admin.patch(f"/admin/v1/catalog/series/{SLUG}/schedule", headers=CONTENT,
                       json={"confirm": SLUG}).status_code == 503
    assert admin.post("/admin/v1/catalog/pricing/bulk", headers=FINANCE,
                      json={"slugs": [SLUG], "coin_price": 20,
                            "confirm": "PRICING"}).status_code == 503


def test_catalog_list_reflects_bulk_pricing(shared):
    admin.post("/admin/v1/catalog/pricing/bulk", headers=FINANCE,
               json={"slugs": [SLUG], "coin_price": 25, "confirm": "PRICING"})
    rows = admin.get("/admin/v1/catalog/series", headers=ADMIN).json()
    row = next(r for r in rows if r["slug"] == SLUG)
    assert row["coinPrice"] == 25 and row["freeEpisodes"] == 10

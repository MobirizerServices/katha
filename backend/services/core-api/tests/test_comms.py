"""Comms transports with the network mocked: SMTP + APNs delivery, failure
capture, provider-JWT caching. The outbox is always written first."""
import time

import pytest

import katha_infra.comms as comms
from katha_infra import Database, SharedStore

T0 = "2026-09-01T00:00:00+00:00"


@pytest.fixture
def shared(tmp_path):
    return SharedStore(Database(f"sqlite+aiosqlite:///{tmp_path/'comms.db'}"))


def test_email_smtp_sent_and_failed(shared, monkeypatch):
    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=0):
            sent.append(("connect", host, port))
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def starttls(self): sent.append(("starttls",))
        def login(self, u, p): sent.append(("login", u, p))
        def send_message(self, msg): sent.append(("send", msg["To"], msg["Subject"]))

    monkeypatch.setenv("KATHA_SMTP_URL", "smtp://mailer:secret@smtp.example:587")
    monkeypatch.setenv("KATHA_EMAIL_FROM", "Katha <no-reply@katha.dev>")
    monkeypatch.setattr(comms.smtplib, "SMTP", FakeSMTP)
    rid = comms.send_email(shared, to="a@b.c", subject="Hello",
                           body_html="<b>hi</b>", now=T0)
    assert ("starttls",) in sent and ("login", "mailer", "secret") in sent
    assert ("send", "a@b.c", "Hello") in sent
    assert shared.outbox_list()[0]["status"] == "sent"

    class BoomSMTP(FakeSMTP):
        def send_message(self, msg): raise OSError("relay refused")
    monkeypatch.setattr(comms.smtplib, "SMTP", BoomSMTP)
    comms.send_email(shared, to="x@y.z", subject="s", body_html="b", now=T0)
    row = shared.outbox_list()[0]
    assert row["status"] == "failed" and "relay refused" in row["detail"]
    assert rid >= 1

    # implicit-TLS variant rides SMTP_SSL without starttls
    calls = []
    class FakeSSL(FakeSMTP):
        def __init__(self, host, port, timeout=0): calls.append(port)
        def starttls(self): raise AssertionError("no starttls on smtps")
    monkeypatch.setenv("KATHA_SMTP_URL", "smtps://smtp.example")
    monkeypatch.setattr(comms.smtplib, "SMTP_SSL", FakeSSL)
    comms.send_email(shared, to="s@s.s", subject="t", body_html="b", now=T0)
    assert calls == [465]


def test_push_apns_sent_failed_and_jwt_cache(shared, monkeypatch, tmp_path):
    # a real ES256 key so the provider JWT actually signs
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization
    key = ec.generate_private_key(ec.SECP256R1())
    p8 = tmp_path / "key.p8"
    p8.write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption()))
    monkeypatch.setenv("KATHA_APNS_KEY_P8", str(p8))
    monkeypatch.setenv("KATHA_APNS_KEY_ID", "KEYID123")
    monkeypatch.setenv("KATHA_APNS_TEAM_ID", "TEAM123")
    monkeypatch.setenv("KATHA_APNS_TOPIC", "dev.katha.app")
    comms._APNS_JWT.clear()

    posts = []
    class FakeResp:
        def __init__(self, code, text=""): self.status_code, self.text = code, text
    class FakeClient:
        result = FakeResp(200)
        def __init__(self, **kw): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, url, json=None, headers=None):
            posts.append((url, json, headers))
            return FakeClient.result
    import httpx
    monkeypatch.setattr(httpx, "Client", FakeClient)

    comms.send_push(shared, device_token="tok1", title="Kaanch Ka Mahal",
                    body="E12 dropped", route={"slug": "k", "episode": 12}, now=T0)
    url, payload, headers = posts[0]
    assert url.endswith("/3/device/tok1") and "sandbox" in url
    assert payload["aps"]["alert"]["title"] == "Kaanch Ka Mahal"
    assert payload["katha"]["episode"] == 12
    assert headers["apns-topic"] == "dev.katha.app"
    assert headers["authorization"].startswith("bearer ")
    assert shared.outbox_list(kind="push")[0]["status"] == "sent"

    jwt1 = headers["authorization"]
    comms.send_push(shared, device_token="tok2", title="t", body="b",
                    route=None, now=T0)
    assert posts[1][2]["authorization"] == jwt1      # cached provider JWT

    FakeClient.result = FakeResp(410, "Unregistered")
    comms.send_push(shared, device_token="dead", title="t", body="b",
                    route=None, now=T0)
    row = shared.outbox_list(kind="push")[0]
    assert row["status"] == "failed" and "410" in row["detail"]

    # prod host selection + expired cache re-mints
    monkeypatch.setenv("KATHA_APNS_ENV", "prod")
    comms._APNS_JWT["exp"] = time.time() - 1
    FakeClient.result = FakeResp(200)
    comms.send_push(shared, device_token="tok3", title="t", body="b",
                    route=None, now=T0)
    assert "api.push.apple.com" in posts[-1][0]


def test_transport_flags_and_invoice_email_render():
    assert comms.email_configured() is False and comms.push_configured() is False
    html = comms.invoice_email_html({
        "id": "KATHA-INV-2627-000007", "created_at": T0, "sku": "coins_web_popular_in",
        "coins": 1300, "bonus_coins": 130, "total_minor": 19900,
        "taxable_minor": 16864, "gst_minor": 3036, "gst_rate_pct": 18,
        "seller_gstin": "27ABCDE1234F1Z5"})
    assert "₹199.00" in html and "₹168.64" in html and "₹30.36" in html
    assert "+130" in html and "27ABCDE1234F1Z5" in html
    no_bonus = comms.invoice_email_html({
        "id": "X", "created_at": T0, "sku": "s", "coins": 600, "bonus_coins": 0,
        "total_minor": 9900, "taxable_minor": 8390, "gst_minor": 1510,
        "gst_rate_pct": 18, "seller_gstin": "G"})
    assert "bonus" not in no_bonus.lower()

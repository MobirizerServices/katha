"""Outbound communications: email + push, outbox-first.

Every send writes an `outbox` row BEFORE any delivery attempt, then the
configured transport delivers and the row's status is updated — so the admin
Outbox view is always the complete, truthful record of what the system tried
to say to whom.

Transports are pure configuration:

- **Email** — `KATHA_SMTP_URL` (e.g. ``smtp://user:pass@smtp.example:587`` —
  STARTTLS, or ``smtps://…:465`` for implicit TLS) plus `KATHA_EMAIL_FROM`.
  Unset → dev mode: the outbox row IS the delivery (status ``queued``,
  nothing leaves the machine).
- **Push (APNs)** — token-based auth: `KATHA_APNS_KEY_P8` (path to the .p8),
  `KATHA_APNS_KEY_ID`, `KATHA_APNS_TEAM_ID`, `KATHA_APNS_TOPIC`
  (``dev.katha.app``), optional `KATHA_APNS_ENV` (``sandbox``/``prod``).
  Delivery uses HTTP/2 (httpx+h2) with an ES256 provider JWT (pyjwt +
  cryptography). Unset → dev outbox mode, same as email.

No provider SDKs, no vendor lock: SMTP and APNs are the wire protocols.
"""
from __future__ import annotations

import json
import os
import smtplib
import time
from email.message import EmailMessage
from urllib.parse import urlparse

from .shared_store import SharedStore


# --- transports --------------------------------------------------------------

def _smtp_deliver(to: str, subject: str, body_html: str) -> None:
    url = urlparse(os.environ["KATHA_SMTP_URL"])
    sender = os.environ.get("KATHA_EMAIL_FROM", "Katha <no-reply@katha.dev>")
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, to, subject
    msg.set_content("This email is best viewed in HTML.")
    msg.add_alternative(body_html, subtype="html")
    port = url.port or (465 if url.scheme == "smtps" else 587)
    cls = smtplib.SMTP_SSL if url.scheme == "smtps" else smtplib.SMTP
    with cls(url.hostname, port, timeout=10) as s:
        if cls is smtplib.SMTP:
            s.starttls()
        if url.username:
            s.login(url.username, url.password or "")
        s.send_message(msg)


_APNS_JWT: dict = {}


def _apns_provider_token() -> str:
    """ES256 provider JWT, cached ~45 min (Apple allows 20–60)."""
    if _APNS_JWT.get("exp", 0) > time.time():
        return _APNS_JWT["jwt"]
    import jwt as pyjwt
    key = open(os.environ["KATHA_APNS_KEY_P8"]).read()
    token = pyjwt.encode(
        {"iss": os.environ["KATHA_APNS_TEAM_ID"], "iat": int(time.time())},
        key, algorithm="ES256",
        headers={"kid": os.environ["KATHA_APNS_KEY_ID"]})
    _APNS_JWT.update(jwt=token, exp=time.time() + 45 * 60)
    return token


def _apns_deliver(device_token: str, payload: dict) -> None:
    import httpx
    host = ("https://api.push.apple.com"
            if os.environ.get("KATHA_APNS_ENV") == "prod"
            else "https://api.sandbox.push.apple.com")
    with httpx.Client(http2=True, timeout=10) as client:
        r = client.post(
            f"{host}/3/device/{device_token}",
            json=payload,
            headers={
                "authorization": f"bearer {_apns_provider_token()}",
                "apns-topic": os.environ.get("KATHA_APNS_TOPIC", "dev.katha.app"),
                "apns-push-type": "alert",
            })
        if r.status_code != 200:
            raise RuntimeError(f"APNs {r.status_code}: {r.text[:120]}")


def email_configured() -> bool:
    return bool(os.environ.get("KATHA_SMTP_URL"))


def push_configured() -> bool:
    return all(os.environ.get(k) for k in
               ("KATHA_APNS_KEY_P8", "KATHA_APNS_KEY_ID", "KATHA_APNS_TEAM_ID"))


# --- the outbox-first senders -----------------------------------------------

def send_email(shared: SharedStore, *, to: str, subject: str, body_html: str,
               now: str) -> int:
    """Outbox row first; SMTP if configured. Returns the outbox row id."""
    row_id = shared.outbox_append(kind="email", recipient=to, subject=subject,
                                  body=body_html, now=now)
    if not email_configured():
        return row_id
    try:
        _smtp_deliver(to, subject, body_html)
        shared.outbox_mark(row_id, "sent")
    except Exception as exc:  # delivery failures are data, not crashes
        shared.outbox_mark(row_id, "failed", detail=str(exc)[:200])
    return row_id


def send_push(shared: SharedStore, *, device_token: str, title: str, body: str,
              route: dict | None, now: str) -> int:
    payload = {"aps": {"alert": {"title": title, "body": body}, "sound": "default"}}
    if route:
        payload["katha"] = route
    row_id = shared.outbox_append(kind="push", recipient=device_token[:16] + "…",
                                  subject=title,
                                  body=json.dumps(payload), now=now)
    if not push_configured():
        return row_id
    try:
        _apns_deliver(device_token, payload)
        shared.outbox_mark(row_id, "sent")
    except Exception as exc:
        shared.outbox_mark(row_id, "failed", detail=str(exc)[:200])
    return row_id


def retry_email(shared: SharedStore, row: dict) -> tuple[bool, str]:
    """Re-attempt delivery of a queued/failed email outbox row (admin Retry).

    Returns (sent, detail). Push rows can't be retried from the outbox — the
    row keeps only a truncated token; re-trigger the drop from the catalog.
    """
    try:
        _smtp_deliver(row["recipient"], row["subject"], row["body"])
        shared.outbox_mark(row["id"], "sent")
        return True, ""
    except Exception as exc:
        detail = str(exc)[:200]
        shared.outbox_mark(row["id"], "failed", detail=detail)
        return False, detail


# --- GST invoice for web (UPI) purchases -------------------------------------

GST_RATE_PCT = 18


def build_invoice(shared: SharedStore, *, user_id: str, order_ref: str, sku: str,
                  coins: int, bonus: int, total_minor: int, now: str) -> dict:
    """Create + persist the invoice record. Prices are GST-inclusive: the tax
    is carved out of the pack price (₹99 = ₹83.90 + ₹15.10 GST @18%)."""
    taxable = round(total_minor * 100 / (100 + GST_RATE_PCT))
    gst = total_minor - taxable
    number = shared.next_invoice_number(now[:4])
    inv = {
        "id": number, "user_id": user_id, "order_ref": order_ref, "sku": sku,
        "coins": coins, "bonus_coins": bonus, "total_minor": total_minor,
        "taxable_minor": taxable, "gst_minor": gst, "gst_rate_pct": GST_RATE_PCT,
        "seller_gstin": os.environ.get("KATHA_GSTIN", "GSTIN-PENDING-REGISTRATION"),
        "created_at": now,
    }
    shared.invoice_create(**inv)
    return inv


def invoice_email_html(inv: dict) -> str:
    r = lambda minor: f"₹{minor // 100}.{minor % 100:02d}"  # noqa: E731
    bonus = (f"<tr><td>Web bonus coins</td><td align='right'>+{inv['bonus_coins']}</td></tr>"
             if inv["bonus_coins"] else "")
    return f"""<div style="font-family:system-ui;max-width:520px;margin:auto">
<h2 style="color:#F65428">Katha — Tax Invoice</h2>
<p><b>{inv['id']}</b> · {inv['created_at'][:10]}<br>
Seller GSTIN: {inv['seller_gstin']} · Place of supply: India</p>
<table width="100%" cellpadding="6" style="border-collapse:collapse">
<tr style="border-bottom:1px solid #ddd"><th align="left">Item</th><th align="right">Amount</th></tr>
<tr><td>Coin pack <code>{inv['sku']}</code> — {inv['coins']} coins</td>
    <td align="right">{r(inv['taxable_minor'])}</td></tr>
{bonus}
<tr><td>GST @ {inv['gst_rate_pct']}%</td><td align="right">{r(inv['gst_minor'])}</td></tr>
<tr style="border-top:2px solid #333"><td><b>Total paid (UPI)</b></td>
    <td align="right"><b>{r(inv['total_minor'])}</b></td></tr>
</table>
<p style="color:#777;font-size:13px">Coins never expire. This is a
computer-generated invoice for a prepaid digital purchase; no signature is
required. Grievances: grievance@katha.example (acknowledged within 24 h).</p>
</div>"""

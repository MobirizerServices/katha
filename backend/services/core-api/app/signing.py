"""Playback-URL signing — the stream token gate (SAD ADR-012), in-process
for dev, CDN-edge in production.

A stream URL is ``/media/t/{token}/{path}``. The token binds a PATH PREFIX
(the episode's hls directory) to a user and an expiry, HMAC-signed with
``KATHA_STREAM_SECRET``. HLS's relative references — master playlist →
variant playlist → segments — all resolve under the same ``/media/t/{token}/``
root, so ONE token authorizes the whole episode tree with no playlist
rewriting. Covers and og cards stay public on the plain ``/media`` route;
episode video without a valid token is refused everywhere.

Production keeps the exact scheme and moves verification to the CDN edge
(signed URLs/cookies); the app tier already speaks it.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import posixpath
import time

_warned_default_secret = False


def _secret() -> bytes:
    secret = os.environ.get("KATHA_STREAM_SECRET")
    if secret is None:
        global _warned_default_secret
        if not _warned_default_secret:
            logging.getLogger("katha.signing").warning(
                "KATHA_STREAM_SECRET is not set — stream tokens are signed with "
                "the committed dev secret, so anyone who can read the repo can "
                "mint them. Set a real secret in any reachable deployment."
            )
            _warned_default_secret = True
        secret = "katha-dev-stream-secret"
    return secret.encode()


def make_token(prefix: str, user_id: str, ttl_s: int = 6 * 3600) -> str:
    """Token for every path under ``prefix``, tied to a user, expiring."""
    exp = int(time.time()) + ttl_s
    payload = f"{prefix}|{user_id}|{exp}"
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    # '.' separates fields (never in slugs/user ids); '~' encodes '/' so the
    # token stays a single path segment.
    return f"{exp}.{user_id}.{prefix.replace('/', '~')}.{sig}"


def check_token(token: str, path: str) -> bool:
    try:
        exp_s, user, pfx, sig = token.split(".", 3)
        exp = int(exp_s)
    except ValueError:
        return False
    if time.time() > exp:
        return False
    prefix = pfx.replace("~", "/")
    payload = f"{prefix}|{user}|{exp}"
    want = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(want, sig):
        return False
    # Scope check on the CANONICAL path: percent-encoded "../" survives route
    # matching, so a raw startswith would let one episode's token walk the whole
    # media tree. Normalize first, and require a real segment boundary so
    # "slug/e001/hls-evil" can't ride a "slug/e001/hls" token either.
    norm = posixpath.normpath(path.lstrip("/"))
    if norm.startswith("..") or norm in (".", ""):
        return False
    if prefix.endswith("/"):
        return norm.startswith(prefix)
    return norm == prefix or norm.startswith(prefix + "/")


def is_video(path: str) -> bool:
    """Episode content (playlists, segments, mezzanines) — token-only.
    Case-insensitive: dev serves from APFS, where /HLS/master.M3U8 finds the
    lowercase file, so a case-sensitive match would be a free bypass."""
    p = path.lower()
    return "/hls/" in p or p.endswith((".m3u8", ".ts", ".mp4"))

"""Feature-flag defaults — the single source both core-api (/v1/config) and
admin-api (/admin/v1/config/flags) read. Admin overrides persist in the shared
DB's admin_kv table and reach clients through /v1/config within one request.
"""
from __future__ import annotations

DEFAULT_FLAGS: dict[str, dict] = {
    "rewards.checkin_enabled": {
        "enabled": True, "description": "Daily check-in card and coin grants", "owner": "growth", "review_by": "2026-12-01"},
    "rewards.referral_enabled": {
        "enabled": False, "description": "Referral coins (P1)", "owner": "growth", "review_by": "2026-11-01"},
    "offers.first_pack_2x": {
        "enabled": True, "description": "2× coins on the first Starter pack", "owner": "growth", "review_by": "2026-12-01"},
    "store.web_enabled": {
        "enabled": True,
        "description": "Web coin store (UPI, +10% bonus). Never referenced inside the iOS app.", "owner": "payments", "review_by": "2027-03-01", "guarded": True},
    "player.trailer_autoplay": {
        "enabled": True, "description": "Muted trailer autoplay on Home (off under data saver)", "owner": "player", "review_by": "2026-12-01"},
    "player.capture_protection": {
        "enabled": True, "description": "Hide video when screen recording is detected", "owner": "player", "review_by": "2027-03-01", "guarded": True},
    "auth.app_attest_enforce": {
        "enabled": True, "description": "App Attest required on auth/money/rewards endpoints", "owner": "platform", "review_by": "2027-03-01", "guarded": True},
    "ai.recs_embeddings": {
        "enabled": False, "description": "Embedding-based candidates instead of heuristic ranking", "owner": "ai", "review_by": "2026-10-15"},
    "app.min_version": {
        "enabled": True, "description": "Force update below 1.0.0 (118) for payment integrity", "owner": "platform", "review_by": "2027-03-01", "guarded": True},
}


def bucket(key: str, user_id: str) -> int:
    """Stable 0-99 bucket for percentage rollout (#056) — the same user always
    lands in the same bucket for a given flag, independent of other flags."""
    import hashlib
    return int(hashlib.sha256(f"{key}:{user_id}".encode()).hexdigest()[:8], 16) % 100


def effective_flags(overrides: dict | None = None,
                    user_id: str | None = None) -> dict[str, bool]:
    """Defaults merged with admin overrides (unknown override keys ignored).

    An override is either a bool (legacy: global on/off) or
    ``{"enabled": bool, "pct": 0-100}`` — a ramp. Without a user context a
    ramped flag only reads true at 100% (anonymous callers never get a partial
    rollout by accident)."""
    merged = {k: v["enabled"] for k, v in DEFAULT_FLAGS.items()}
    for k, v in (overrides or {}).items():
        if k not in merged:
            continue
        if isinstance(v, dict):
            enabled = bool(v.get("enabled", False))
            pct = int(v.get("pct", 100))
            if enabled and pct < 100:
                enabled = user_id is not None and bucket(k, user_id) < pct
            merged[k] = enabled
        else:
            merged[k] = bool(v)
    return merged

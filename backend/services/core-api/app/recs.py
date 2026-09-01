"""Deterministic personalization for the home feed — launch-grade, no model.

Two ranked signals, both computed from data the platform already records:

- **Trending** — 7-day ``play_start`` counts from the events pipeline (#011);
  a fresh install with no events falls back to catalog order.
- **Because you watched** — the viewer's strongest seed series (most episodes
  with progress, freshest wins ties), against which every served series is
  scored by genre overlap (×2) + shared tropes + same language.

The same events later feed the ai-service recs graphs (SAD ADR-006); swapping
the scorer for a learned one keeps this module's contract intact.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from katha_domain import catalog
from katha_domain.schemas import SeriesSummary

from .store import store


def trending_counts(days: int = 7) -> dict[str, int]:
    if store.shared is None:
        return {}
    since = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    counts: dict[str, int] = {}
    for ref, n in store.shared.event_counts("play_start", since_day=since).items():
        slug = ref.split(":", 1)[0]
        counts[slug] = counts.get(slug, 0) + n
    return counts


def rank_trending(series: list[SeriesSummary]) -> list[SeriesSummary]:
    counts = trending_counts()
    if not counts:
        return series
    return sorted(series, key=lambda s: -counts.get(s.slug, 0))  # stable: ties keep order


def seed_series(user_id: str) -> str | None:
    """The series this viewer is most invested in: most episodes with any
    progress; the freshest touch breaks ties."""
    eng = store.engagement.get(user_id)
    if not eng or not eng.progress:
        return None
    stats: dict[str, tuple[int, str]] = {}
    for item in eng.progress.values():
        n, latest = stats.get(item.slug, (0, ""))
        stats[item.slug] = (n + 1, max(latest, item.updated_at))
    return max(stats, key=lambda s: stats[s])


def because_you_watched(user_id: str, served: list[SeriesSummary],
                        limit: int = 8) -> tuple[str, list[SeriesSummary]] | None:
    slug = seed_series(user_id)
    if slug is None:
        return None
    seed_sum = next((s for s in served if s.slug == slug), None)
    seed_det = catalog.get_series(slug)
    anchor = seed_sum or seed_det
    if anchor is None:      # seed vanished from the catalog (archived draft)
        return None
    seed_genres = set(anchor.genres)
    seed_tropes = set(seed_det.tropes) if seed_det else set()
    scored: list[tuple[int, SeriesSummary]] = []
    for s in served:
        if s.slug == slug:
            continue
        det = catalog.get_series(s.slug)
        score = 2 * len(seed_genres & set(s.genres))
        score += len(seed_tropes & set(det.tropes)) if det else 0
        score += 1 if s.primary_language == anchor.primary_language else 0
        if score:
            scored.append((score, s))
    if not scored:
        return None
    scored.sort(key=lambda t: -t[0])                             # stable
    return anchor.title, [s for _, s in scored[:limit]]

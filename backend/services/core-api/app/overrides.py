"""Back-office catalog overrides, applied at serve time (admin review
#034/#040/#043).

The seed JSON stays the base catalog; the shared KV carries what operators
change from the panel:
- ``price:{slug}``   → {"coin_price": int, "free_episodes": int} — per-series
  pricing (#040). Applied to detail, playback pricing AND the money paths, so
  the paywall never advertises a price the ledger doesn't charge.
- ``ep:{slug}:{n}``  → {"title": str} — episode retitles (#034).
- ``series:{slug}``  → a full draft series created in the panel (#043); it
  reaches the public catalog only once its ``status:`` is flipped to live.
"""
from __future__ import annotations

import json as _json

from katha_domain import catalog
from katha_domain.schemas import Episode, SeriesDetail, SeriesSummary


def _kv_json(key: str) -> dict:
    from .store import store
    raw = store.kv(key)
    if not raw:
        return {}
    try:
        return _json.loads(raw)
    except ValueError:
        return {}


def apply_pricing(s: SeriesDetail) -> SeriesDetail:
    over = _kv_json(f"price:{s.slug}")
    price = int(over.get("coin_price", s.episode_coin_price))
    free = int(over.get("free_episodes", s.free_episode_count))
    from .store import store
    titles = {}
    for suffix, raw in store.kv_prefix(f"ep:{s.slug}:").items():
        try:
            titles[int(suffix)] = _json.loads(raw).get("title", "")
        except ValueError:
            continue
    if price == s.episode_coin_price and free == s.free_episode_count and not titles:
        return s
    episodes = [
        e.model_copy(update={
            "is_free": e.number <= free,
            "coin_price": 0 if e.number <= free else price,
            **({"title": titles[e.number]} if titles.get(e.number) else {}),
        })
        for e in s.episodes
    ]
    return s.model_copy(update={"episode_coin_price": price,
                                "free_episode_count": free,
                                "episodes": episodes})


def draft_series(slug: str) -> SeriesDetail | None:
    """A series created in the back office (#043), stored whole in the KV."""
    d = _kv_json(f"series:{slug}")
    if not d.get("title"):
        return None
    count = int(d.get("episode_count", 0))
    price = int(d.get("coin_price", catalog.pricing()["episode_coin_price"]))
    free = int(d.get("free_episodes", catalog.pricing()["free_episode_count"]))
    return SeriesDetail(
        slug=slug, title=d["title"], genres=d.get("genres", []),
        episode_count=count, primary_language=d.get("language", "hi"),
        content_rating=d.get("rating", "U/A 13+"),
        synopsis=d.get("synopsis", ""), tropes=d.get("tropes", []),
        free_episode_count=free, episode_coin_price=price,
        bundle_discount_pct=int(d.get("bundle_discount_pct",
                                      catalog.pricing()["bundle_discount_pct"])),
        episodes=[Episode(number=n, title=f"Episode {n}", is_free=n <= free,
                          coin_price=0 if n <= free else price)
                  for n in range(1, count + 1)],
    )


def draft_slugs() -> list[str]:
    from .store import store
    return sorted(store.kv_prefix("series:").keys())


def get_series(slug: str) -> SeriesDetail | None:
    """The one lookup every money path uses: seed or panel-drafted series,
    with panel pricing applied."""
    s = catalog.get_series(slug) or draft_series(slug)
    return apply_pricing(s) if s is not None else None


def all_summaries() -> list[SeriesSummary]:
    base = catalog.summaries()
    seen = {s.slug for s in base}
    out = list(base)
    for slug in draft_slugs():
        if slug in seen:
            continue
        d = draft_series(slug)
        if d is not None:
            out.append(SeriesSummary(**{k: getattr(d, k)
                                        for k in SeriesSummary.model_fields}))
    return out

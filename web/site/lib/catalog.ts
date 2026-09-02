// Catalog + coin-economy source of truth for the web surface.
// Series metadata is pulled from the shared seed catalog (same file the core-api serves).
// Money rules mirror the ledger package facts; do not invent new numbers here.
import seed from "./seed_catalog.json";

/* ----------------------------- pricing facts ----------------------------- */
export const FREE_EPISODES = seed._meta.pricing_profile.free_episode_count; // 10
export const EPISODE_COIN_PRICE = seed._meta.pricing_profile.episode_coin_price; // 30
export const BUNDLE_DISCOUNT_PCT = seed._meta.pricing_profile.bundle_discount_pct; // 25
export const RUPEES_PER_COIN = 0.15; // 1 coin ~= Rs 0.15
export const WEB_BONUS_PCT = 10; // web store adds +10% bonus coins

/** Rupee estimate for a coin amount, e.g. 30 coins -> "4.5". */
export function coinsToRupees(coins: number): string {
  return (coins * RUPEES_PER_COIN).toFixed(1);
}

export interface CoinPack {
  sku: string;
  name: string;
  coins: number;
  priceInr: number;
  tag?: string;
  gold?: boolean;
  highlight?: boolean;
}

// App Store / IAP packs (product facts). Web store layers a +10% bonus on top.
export const COIN_PACKS: CoinPack[] = [
  { sku: "coins_starter_in", name: "Starter", coins: 600, priceInr: 99, tag: "2x on first pack", gold: true },
  { sku: "coins_popular_in", name: "Popular", coins: 1300, priceInr: 199, tag: "Most chosen", highlight: true },
  { sku: "coins_value_in", name: "Value", coins: 3500, priceInr: 499 },
  { sku: "coins_binge_in", name: "Binge", coins: 7500, priceInr: 999 },
  { sku: "coins_mega_in", name: "Mega", coins: 16000, priceInr: 1999 },
];

/** Web-store bonus coins for a base coin amount (+10%, rounded). */
export function webBonusCoins(base: number): number {
  return Math.round((base * WEB_BONUS_PCT) / 100);
}

/** Total coins a web purchase grants (base + 10% web bonus). */
export function webTotalCoins(base: number): number {
  return base + webBonusCoins(base);
}

/* ----------------------------- series model ------------------------------ */
export interface Episode {
  number: number;
  title: string;
  isFree: boolean;
  coinPrice: number;
}

export interface Series {
  slug: string;
  title: string;
  synopsis: string;
  genres: string[];
  tropes: string[];
  episodeCount: number;
  language: string; // display language
  rating: string;
  c1: string; // poster gradient start
  c2: string; // poster gradient end
  rank: number;
  episodes: Episode[];
}

// Presentation overlay: gradient key-art colors, display language, and rating
// per seed slug. Keeps the seed JSON pure metadata while giving the UI real art.
const PRESENTATION: Record<string, { c1: string; c2: string; language: string; rating: string }> = {
  "his-one-and-only-love": { c1: "#3B1F2B", c2: "#C2553D", language: "Hindi", rating: "U/A 16+" },
  "i-wish-it-were-you": { c1: "#2E1F3F", c2: "#D66E9D", language: "Tamil", rating: "U/A 13+" },
  "step-back-im-the-hidden-king": { c1: "#0F2A3D", c2: "#3E7C9A", language: "Hindi", rating: "U/A 13+" },
  "tempest-the-last-mecha": { c1: "#142033", c2: "#4A78A8", language: "Telugu", rating: "U/A 13+" },
  "lady-diamonds-lost-heiress-returns": { c1: "#4A1620", c2: "#E0576A", language: "Hindi", rating: "U/A 16+" },
  "deny-me-dragon-king": { c1: "#0F3A3D", c2: "#3FA796", language: "Telugu", rating: "U/A 16+" },
};

const LANG_NAMES: Record<string, string> = { hi: "Hindi", ta: "Tamil", te: "Telugu" };

const FALLBACK_PRES = { c1: "#1D1A2F", c2: "#6C4AB6", language: "Hindi", rating: "U/A 16+" };

export const SERIES: Series[] = seed.series.map((s: any, i: number): Series => {
  const pres = PRESENTATION[s.slug] || FALLBACK_PRES;
  return {
    slug: s.slug,
    title: s.title,
    synopsis: s.synopsis,
    genres: s.genres || [],
    tropes: s.tropes || [],
    episodeCount: s.episode_count,
    language: LANG_NAMES[s.primary_language] ?? pres.language,
    rating: s.content_rating ?? pres.rating,
    c1: pres.c1,
    c2: pres.c2,
    rank: i + 1,
    episodes: (s.episodes || []).map((e: any) => ({
      number: e.number,
      title: e.title,
      isFree: e.is_free,
      coinPrice: e.coin_price,
    })),
  };
});

export function getSeries(slug: string): Series | undefined {
  return SERIES.find((s) => s.slug === slug);
}

export function allSlugs(): string[] {
  return SERIES.map((s) => s.slug);
}

/** Is episode n free to watch (no coins, no account)? First 10 of every series. */
export function isFreeEpisode(n: number): boolean {
  return n <= FREE_EPISODES;
}

/** Coin cost to unlock the remaining locked episodes as a bundle (25% off). */
export function bundleCost(series: Series): number {
  const lockedCount = Math.max(0, series.episodeCount - FREE_EPISODES);
  const full = lockedCount * EPISODE_COIN_PRICE;
  return Math.round((full * (100 - BUNDLE_DISCOUNT_PCT)) / 100);
}

/** Full (undiscounted) coin cost of all locked episodes. */
export function fullLockedCost(series: Series): number {
  const lockedCount = Math.max(0, series.episodeCount - FREE_EPISODES);
  return lockedCount * EPISODE_COIN_PRICE;
}

/** Thousands-separated number, e.g. 1300 -> "1,300". */
export function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}

/** Cover art served by core-api's /media route (CDN in production). */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8799";
export function coverUrl(slug: string, wide = false): string {
  return `${API_BASE}/media/${slug}/cover_${wide ? "16x9" : "9x16"}.jpg`;
}

/** JSON for an inline <script type="application/ld+json"> block. Escapes '<'
 * so no value can smuggle a '</script>' out of the element — inert with
 * today's static seed data, mandatory the day synopses come from live admin
 * content. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

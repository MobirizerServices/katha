// Catalog + coin-economy source of truth for the web surface.
// Series metadata is pulled from the shared seed catalog (same file the core-api serves).
// Money rules mirror the ledger package facts; do not invent new numbers here.
import seed from "./seed_catalog.json";

/* ----------------------------- pricing facts ----------------------------- */
export const FREE_EPISODES = seed._meta.pricing_profile.free_episode_count; // 10
export const EPISODE_COIN_PRICE = seed._meta.pricing_profile.episode_coin_price; // 30
export const BUNDLE_DISCOUNT_PCT = seed._meta.pricing_profile.bundle_discount_pct; // 25
export const RUPEES_PER_COIN = 0.15; // 1 coin ~= Rs 0.15 (marketing copy only; live rate from /v1/config)

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
  { sku: "coins_starter_in", name: "Starter", coins: 600, priceInr: 99, tag: "Best to start", gold: true },
  { sku: "coins_popular_in", name: "Popular", coins: 1300, priceInr: 199, tag: "Most chosen", highlight: true },
  { sku: "coins_value_in", name: "Value", coins: 3500, priceInr: 499 },
  { sku: "coins_binge_in", name: "Binge", coins: 7500, priceInr: 999 },
  { sku: "coins_mega_in", name: "Mega", coins: 16000, priceInr: 1999 },
];

/** How the store PRESENTS each SKU (name, badge, emphasis). Coin counts,
 * prices and the web bonus come from the server (/v1/iap/packs), never here. */
export const PACK_PRESENTATION: Record<string, { name: string; tag?: string; gold?: boolean; highlight?: boolean }> =
  Object.fromEntries(COIN_PACKS.map((p) => [p.sku, { name: p.name, tag: p.tag, gold: p.gold, highlight: p.highlight }]));

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
  rating: string;   // seed rating; the live rating comes from /v1/series/{slug}
  c1: string; // poster gradient start
  c2: string; // poster gradient end
  episodes: Episode[];
}

type Gradient = { c1: string; c2: string };

// Presentation overlay: gradient key-art colors per seed slug, on the ember
// palette (lamplight darks warmed by sindoor / marigold). Keeps the seed JSON
// pure metadata while giving the UI real art behind the placeholder covers.
const PRESENTATION: Record<string, Gradient> = {
  "kaanch-ka-mahal": { c1: "#3A1F1A", c2: "#C2553D" },
  "ceo-sahab": { c1: "#2E1721", c2: "#D0687C" },
  "dilli-6-ka-raaz": { c1: "#1B1512", c2: "#7A4A2A" },
  "saat-pheron-ka-sauda": { c1: "#33191A", c2: "#D2734F" },
  "raja-ki-beti": { c1: "#2B2110", c2: "#C79A3A" },
  "neend-se-pehle": { c1: "#141010", c2: "#5B3A33" },
  "kabir-ka-kanoon": { c1: "#241412", c2: "#9E3B2B" },
  "nizam-ka-sauda": { c1: "#1E1710", c2: "#8A6230" },
  "kadhal-kanakku": { c1: "#2D1A20", c2: "#D77A6A" },
  "vetri-vaasal": { c1: "#1C2116", c2: "#7E9A3E" },
  "sunday-sambar": { c1: "#33240F", c2: "#E0A63A" },
  "prema-pariksha": { c1: "#2B1B24", c2: "#C86E8C" },
  "rajahmundry-rani": { c1: "#301B14", c2: "#B96A38" },
  "nalugu-ghantalu": { c1: "#171512", c2: "#6B5330" },
};

// A new seed row must never land on one generic gradient again (the bug the
// slug map above drifted into), so genre carries the art when a slug is new.
const GENRE_ART: Record<string, Gradient> = {
  "Family Drama": { c1: "#3A1F1A", c2: "#C2553D" },
  Romance: { c1: "#2E1721", c2: "#D0687C" },
  "Thriller/Crime": { c1: "#1B1512", c2: "#7A4A2A" },
  "Fantasy/Mythology": { c1: "#2B2110", c2: "#C79A3A" },
  Horror: { c1: "#141010", c2: "#5B3A33" },
  Revenge: { c1: "#241412", c2: "#9E3B2B" },
  Sports: { c1: "#1C2116", c2: "#7E9A3E" },
  Comedy: { c1: "#33240F", c2: "#E0A63A" },
};

const LANG_NAMES: Record<string, string> = { hi: "Hindi", ta: "Tamil", te: "Telugu" };

/** Display name for a content-language code ("hi" -> "Hindi"); unknown codes pass through. */
export function languageName(code: string): string {
  return LANG_NAMES[code] ?? code;
}

/** The content languages the catalog serves, in the order the UI lists them. */
export const LANGUAGES: { code: string; name: string; native: string }[] = [
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "te", name: "Telugu", native: "తెలుగు" },
];

/** Every genre in the catalog, alphabetical, for the browse filter chips. */
export function allGenres(series: { genres: string[] }[]): string[] {
  return Array.from(new Set(series.flatMap((s) => s.genres))).sort();
}

/** Browse filter: a series matches when it carries the genre AND is in the language. */
export function filterSeries<T extends { genres: string[]; language: string }>(
  series: T[],
  f: { genre?: string | null; lang?: string | null }
): T[] {
  return series.filter(
    (s) => (!f.genre || s.genres.includes(f.genre)) && (!f.lang || s.language === f.lang)
  );
}

/** The card meta line: "Hindi · Romance · 60 episodes" (a missing genre is skipped). */
export function metaLine(language: string, genre: string | undefined, episodes: number): string {
  return [language, genre, `${episodes} episodes`].filter(Boolean).join(" · ");
}

/** Phone for display: "+91 98765 43210" -> "+91 98765 •••10". The three
 * digits before the last two are hidden; everything else is kept as typed. */
export function maskPhone(phone: string): string {
  let seen = 0;
  const out: string[] = [];
  for (let i = phone.length - 1; i >= 0; i--) {
    const ch = phone[i];
    if (/\d/.test(ch)) {
      seen++;
      out.push(seen >= 3 && seen <= 5 ? "•" : ch);
    } else {
      out.push(ch);
    }
  }
  return out.reverse().join("");
}

const FALLBACK_PRES = { c1: "#2A1A16", c2: "#8A4A2F", language: "Hindi", rating: "U/A 16+" };

export const SERIES: Series[] = seed.series.map((s: any): Series => {
  const genres: string[] = s.genres || [];
  const pres = PRESENTATION[s.slug] ?? GENRE_ART[genres[0]] ?? FALLBACK_PRES;
  return {
    slug: s.slug,
    title: s.title,
    synopsis: s.synopsis,
    genres,
    tropes: s.tropes || [],
    episodeCount: s.episode_count,
    language: LANG_NAMES[s.primary_language] ?? FALLBACK_PRES.language,
    rating: s.content_rating ?? FALLBACK_PRES.rating,
    c1: pres.c1,
    c2: pres.c2,
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

/** "1 person" / "2 people" — a counted noun that agrees with its number. */
export function countLabel(n: number, one: string, many: string): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

/** A playback position as a clock: 23 -> "0:23", 3723 -> "1:02:03". A
 * not-yet-known duration (NaN/Infinity, as before loadedmetadata) reads "0:00". */
export function clock(seconds: number): string {
  const t = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const s = t % 60;
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** Cover art served by core-api's /media route (CDN in production). */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:8799");
/** Absolute origin for URLs that leave the page (og:image, JSON-LD): the public
 *  site origin, since /media is served on it in production. */
export const PUBLIC_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN || API_BASE || "http://localhost:3000";
export function coverUrl(slug: string, wide = false): string {
  return `${API_BASE}/media/${slug}/cover_${wide ? "16x9" : "9x16"}.jpg`;
}
export function ogImageUrl(slug: string): string {
  return `${PUBLIC_ORIGIN}/media/${slug}/og_1200x630.jpg`;
}

/** JSON for an inline <script type="application/ld+json"> block. Escapes '<'
 * so no value can smuggle a '</script>' out of the element — inert with
 * today's static seed data, mandatory the day synopses come from live admin
 * content. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

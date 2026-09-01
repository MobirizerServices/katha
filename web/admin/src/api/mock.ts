// Static mock fallback so the admin SPA builds and renders without admin-api.
// The 6 series mirror backend/services/core-api/app/data/seed_catalog.json.
// Pricing profile: 10 free episodes, then 30 coins/episode, 25% bundle discount.
import type {
  AdminUser,
  Approval,
  AuditEntry,
  FeatureFlag,
  Overview,
  Series,
} from "./types";

const HOUR = 3600e3;
const NOW = Date.UTC(2026, 7, 31, 6, 0, 0); // stable, deterministic for tests

// Seed catalog is English-language test data; the live product ships Hindi,
// Tamil and Telugu, so we present the seed slugs across those three languages.
const LANGS = ["Hindi", "Tamil", "Telugu"];
const OWNERS = ["Riya", "Nikhil", "Priya", "Sai"];
const RATINGS = ["U/A 13+", "U/A 16+", "U/A 7+", "U"];
const STATUSES: Series["status"][] = ["live", "live", "sched", "qc", "live", "draft"];

interface SeedRow {
  slug: string;
  title: string;
  synopsis: string;
  genres: string[];
  episodeCount: number;
}

const SEED: SeedRow[] = [
  {
    slug: "his-one-and-only-love",
    title: "His One and Only Love",
    synopsis:
      "A dark romance following Lyla, rescued by billionaire Leo Adams, who faces interference from a rival claiming to be Leo's fiancee.",
    genres: ["Romance", "Dark Romance", "Billionaire"],
    episodeCount: 81,
  },
  {
    slug: "i-wish-it-were-you",
    title: "I Wish It Were You",
    synopsis: "A sweet second-chance love story of two hearts finding their way back.",
    genres: ["Romance", "Sweet Love"],
    episodeCount: 78,
  },
  {
    slug: "step-back-im-the-hidden-king",
    title: "Step Back! I'm the Hidden King",
    synopsis: "An underestimated heir reclaims a hidden empire and the woman who believed in him.",
    genres: ["Romance", "Billionaire"],
    episodeCount: 63,
  },
  {
    slug: "tempest-the-last-mecha",
    title: "Tempest: The Last Mecha",
    synopsis: "In a war-torn future, the last mecha pilot stands between humanity and extinction.",
    genres: ["Action", "Science Fiction"],
    episodeCount: 58,
  },
  {
    slug: "lady-diamonds-lost-heiress-returns",
    title: "Lady Diamond's Lost Heiress Returns",
    synopsis: "A lost heiress returns to reclaim her family and settle old scores.",
    genres: ["Revenge", "Family Drama"],
    episodeCount: 56,
  },
  {
    slug: "deny-me-dragon-king",
    title: "Deny Me, Dragon King",
    synopsis: "A mortal woman defies a dragon king and rewrites the fate of two realms.",
    genres: ["Romance", "Fantasy"],
    episodeCount: 50,
  },
];

export const MOCK_SERIES: Series[] = SEED.map((s, i) => {
  const status = STATUSES[i % STATUSES.length];
  const live = status === "live" ? Math.max(10, s.episodeCount - (i % 5) * 8) : 0;
  return {
    id: "srs_" + String(i + 1).padStart(2, "0"),
    slug: s.slug,
    title: s.title,
    synopsis: s.synopsis,
    genres: s.genres,
    language: LANGS[i % LANGS.length],
    episodeCount: s.episodeCount,
    liveCount: live,
    freeEpisodes: 10,
    coinPrice: 30,
    bundleDiscountPct: 25,
    status,
    rating: status === "draft" ? "—" : RATINGS[i % RATINGS.length],
    owner: OWNERS[i % OWNERS.length],
    updatedAt: NOW - (i * 7 + 3) * HOUR,
  };
});

export const MOCK_USERS: AdminUser[] = [
  {
    id: "usr_7b1e",
    phone: "+91 98765 •••21",
    name: "Meera K.",
    languages: "hi, ta",
    wallet: { bought: 1200, bonus: 100, unlocked: 214, ltv: "₹2,940" },
    lastActive: "Today 09:12",
    flags: ["refund 1/6"],
    devices: ["iPhone 15 (this)", "iPhone 12"],
    payer: "Aug 3 · 4 purchases",
  },
  {
    id: "usr_9a02",
    phone: "+91 90123 •••08",
    name: "Arjun R.",
    languages: "te",
    wallet: { bought: 0, bonus: 45, unlocked: 11, ltv: "₹0" },
    lastActive: "Today 08:50",
    flags: [],
    devices: ["iPhone 13"],
    payer: "—",
  },
  {
    id: "usr_c4d1",
    phone: "+91 88888 •••40",
    name: "—",
    languages: "hi",
    wallet: { bought: 3500, bonus: 0, unlocked: 96, ltv: "₹1,190" },
    lastActive: "Yesterday",
    flags: ["refund 3/5", "review"],
    devices: ["iPhone 14", "iPhone 14", "iPhone SE"],
    payer: "Jul 20 · 6 purchases",
  },
  {
    id: "usr_11ef",
    phone: "+91 97654 •••77",
    name: "Priya S.",
    languages: "hi",
    wallet: { bought: 600, bonus: 25, unlocked: 52, ltv: "₹420" },
    lastActive: "Today 07:31",
    flags: [],
    devices: ["iPhone 15 Pro"],
    payer: "Sep 12 · 1 purchase",
  },
  {
    id: "usr_a1b2",
    phone: "+91 93210 •••55",
    name: "Sunil M.",
    languages: "hi",
    wallet: { bought: 1300, bonus: 60, unlocked: 88, ltv: "₹870" },
    lastActive: "Today 09:01",
    flags: ["3 devices"],
    devices: ["iPhone 13", "iPhone 12", "iPad (blocked)"],
    payer: "Aug 28 · 2 purchases",
  },
  {
    id: "usr_d8e3",
    phone: "+880 17•• •••• 12",
    name: "—",
    languages: "hi",
    wallet: { bought: 0, bonus: 5, unlocked: 0, ltv: "₹0" },
    lastActive: "40 min",
    flags: ["OTP range paused"],
    devices: ["iPhone 11"],
    payer: "—",
  },
];

export const MOCK_APPROVALS: Approval[] = [
  {
    id: "apr_1",
    kind: "Coin adjustment",
    detail:
      "+1,300 bought coins · usr_c4d1 · reason: failed transaction verified (App Store) · ticket T-8819",
    requestedBy: "Farah Khan",
    when: "08:40",
    needs: "Finance or Admin",
    amount: 1300,
    userId: "usr_c4d1",
  },
  {
    id: "apr_2",
    kind: "Price change",
    detail: "His One and Only Love · episode price 30 → 22 coins (−27%) · bundle unchanged",
    requestedBy: "Priya Nair",
    when: "Yesterday",
    needs: "Admin",
  },
  {
    id: "apr_3",
    kind: "Takedown",
    detail: "Deny Me, Dragon King · reason: grievance G-0142 · hide from 80 unlockers",
    requestedBy: "Sameer Joshi (Legal)",
    when: "Yesterday 23:10",
    needs: "Admin (second)",
  },
];

export const MOCK_FLAGS: FeatureFlag[] = [
  { key: "rewards.checkin_enabled", description: "Daily check-in card and coin grants", enabled: true, env: "prod" },
  { key: "rewards.referral_enabled", description: "Referral coins (P1)", enabled: false, env: "prod" },
  { key: "offers.first_pack_2x", description: "2× coins on the first Starter pack", enabled: true, env: "prod" },
  { key: "store.web_enabled", guarded: true, owner: "payments", review_by: "2027-03-01", description: "Web coin store (UPI, +10% bonus). Never referenced inside the iOS app.", enabled: true, env: "prod" },
  { key: "player.trailer_autoplay", description: "Muted trailer autoplay on Home (off under data saver)", enabled: true, env: "prod" },
  { key: "player.capture_protection", description: "Hide video when screen recording is detected", enabled: true, env: "prod" },
  { key: "auth.app_attest_enforce", description: "App Attest required on auth/money/rewards endpoints", enabled: true, env: "prod" },
  { key: "ai.recs_embeddings", description: "Embedding-based candidates instead of heuristic ranking", enabled: false, env: "prod" },
  { key: "app.min_version", description: "Force update below 1.0.0 (118) for payment integrity", enabled: true, env: "prod" },
];

export const MOCK_AUDIT: AuditEntry[] = [
  { ts: NOW - 6 * 60e3, actor: "Riya Menon", action: "episode.publish", entity: "His One and Only Love E58", change: "status qc → live" },
  { ts: NOW - 14 * 60e3, actor: "system (reconcile-ledger)", action: "wallet.rebuild", entity: "all users", change: "0 mismatches" },
  { ts: NOW - 26 * 60e3, actor: "Arjun Rao", action: "moderation.decide", entity: "Deny Me, Dragon King E6", change: "rating — → U/A 7+ · descriptors: mild peril" },
  { ts: NOW - 37 * 60e3, actor: "system (appstore-notifications)", action: "ledger.refund_clawback", entity: "usr_7b1e", change: "−1,300 bought · iap 2000000123400002" },
  { ts: NOW - 38 * 60e3, actor: "Farah Khan", action: "wallet.adjust", entity: "usr_11ef", change: "+600 bought · failed transaction verified (App Store) · T-8801" },
  { ts: NOW - 48 * 60e3, actor: "Devika Iyer", action: "finance.import", entity: "Apple payout Aug 2026", change: "matched ₹1.62 Cr · 0 diff" },
  { ts: NOW - 80 * 60e3, actor: "Sameer Joshi", action: "flag.update", entity: "offers.first_pack_2x", change: "off → on" },
  { ts: NOW - 98 * 60e3, actor: "Riya Menon", action: "series.update", entity: "I Wish It Were You", change: "synopsis (hi) edited" },
  { ts: NOW - 10 * HOUR, actor: "Legal (Sameer Joshi)", action: "series.takedown_request", entity: "Deny Me, Dragon King", change: "requested · pending second approver" },
];

export const MOCK_OVERVIEW: Overview = {
  // Mirrors the live /admin/v1/overview shape: real KPI labels, sample values.
  kpis: [
    { label: "Registered users", value: "1,204" },
    { label: "Coins purchased (all time)", value: "1,86,400" },
    { label: "Coins outstanding", value: "42,310", delta: "6,120 bonus", deltaDir: "up" },
    { label: "Episodes unlocked", value: "4,812" },
    { label: "Gross revenue equivalent", value: "₹27,960" },
    { label: "Live series", value: "14" },
  ],
  attention: [],          // live signals come from /admin/v1/attention
  pipeline: [
    { label: "Uploading & probing", count: 3, pct: 12, tone: "info" },
    { label: "Transcoding & packaging", count: 5, pct: 20, tone: "info" },
    { label: "Human QC & rating", count: 14, pct: 56, tone: "" },
    { label: "Scheduled (next 7 days)", count: 61, pct: 100, tone: "ok" },
  ],
};

// Coin packs (product facts) shown on the Config view.
export const MOCK_PACKS: [string, string, string, string, string, string][] = [
  ["coins_starter_in", "IN", "₹99", "600", "—", "2× first purchase"],
  ["coins_popular_in", "IN", "₹199", "1,300", "8%", "Highlighted"],
  ["coins_value_in", "IN", "₹499", "3,500", "17%", "—"],
  ["coins_binge_in", "IN", "₹999", "7,500", "25%", "Double-coins Sat–Sun"],
  ["coins_mega_in", "IN", "₹1,999", "16,000", "33%", "—"],
  ["coins_web_popular_in", "Web (UPI)", "₹199", "1,430", "+10% web", "Web only · never shown in app"],
];

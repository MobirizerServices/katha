// Shared analytics fixture for the board views (Overview / Analytics / Finance).
export const W = (over: Partial<Record<string, number>> = {}) => ({
  coins_purchased: 1500, revenue_rupees: 225, coins_iap: 1000, coins_web: 500,
  unlocks: 12, dau_peak: 40, new_users: 9, watch_minutes: 300,
  coins_refunded: 100, refund_ratio_pct: 6.67, ...over,
});

export const ANALYTICS = {
  windows: {
    today: { current: W(), previous: W({ coins_purchased: 1000, revenue_rupees: 150 }) },
    "7d": { current: W({ revenue_rupees: 1000 }), previous: W({ revenue_rupees: 500 }) },
    "30d": { current: W(), previous: W() },
  },
  funnel: {
    "1d": { paywall_view: 10, purchase: 4, unlock: 3 },
    "7d": { paywall_view: 100, purchase: 40, unlock: 30 },
    "30d": { paywall_view: 300, purchase: 100, unlock: 80 },
  },
  days: Array.from({ length: 30 }, (_, i) => `2026-08-${i + 1}`),
  // paywall_views is one short on purpose: the day table pads a missing point.
  spark: Object.fromEntries(["coins_purchased", "unlocks", "dau", "new_users",
                             "watch_minutes", "paywall_views"]
    .map((k) => [k, Array.from({ length: k === "paywall_views" ? 29 : 30 }, (_, i) => i)])),
  outstanding_trend: Array.from({ length: 30 }, (_, i) => 1000 + i),
  outstanding_rupees: 154,
  breakage_dormant_coins: 77,
  coin_rupee_rate: 0.15,
  generated_at: "2026-09-01T18:00:00+00:00",
};

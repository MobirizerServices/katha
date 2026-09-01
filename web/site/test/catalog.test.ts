import { describe, it, expect } from "vitest";
import {
  FREE_EPISODES,
  EPISODE_COIN_PRICE,
  BUNDLE_DISCOUNT_PCT,
  RUPEES_PER_COIN,
  WEB_BONUS_PCT,
  COIN_PACKS,
  SERIES,
  coinsToRupees,
  webBonusCoins,
  webTotalCoins,
  isFreeEpisode,
  bundleCost,
  fullLockedCost,
  getSeries,
  allSlugs,
  fmt,
  type Series,
} from "@/lib/catalog";

describe("pricing constants", () => {
  it("mirrors the ledger pricing profile", () => {
    expect(FREE_EPISODES).toBe(10);
    expect(EPISODE_COIN_PRICE).toBe(30);
    expect(BUNDLE_DISCOUNT_PCT).toBe(25);
    expect(RUPEES_PER_COIN).toBe(0.15);
    expect(WEB_BONUS_PCT).toBe(10);
  });

  it("ships the five product coin packs at the documented prices", () => {
    expect(COIN_PACKS).toHaveLength(5);
    const bySku = Object.fromEntries(COIN_PACKS.map((p) => [p.sku, p]));
    expect(bySku["coins_starter_in"]).toMatchObject({ coins: 600, priceInr: 99 });
    expect(bySku["coins_popular_in"]).toMatchObject({ coins: 1300, priceInr: 199 });
    expect(bySku["coins_value_in"]).toMatchObject({ coins: 3500, priceInr: 499 });
    expect(bySku["coins_binge_in"]).toMatchObject({ coins: 7500, priceInr: 999 });
    expect(bySku["coins_mega_in"]).toMatchObject({ coins: 16000, priceInr: 1999 });
  });
});

describe("coinsToRupees", () => {
  it("estimates 30 coins ~= Rs 4.5", () => {
    expect(coinsToRupees(30)).toBe("4.5");
  });
  it("formats to one decimal place", () => {
    expect(coinsToRupees(0)).toBe("0.0");
    expect(coinsToRupees(100)).toBe("15.0");
  });
});

describe("web bonus math (+10%)", () => {
  it("adds a rounded +10% bonus on the base", () => {
    expect(webBonusCoins(1300)).toBe(130);
    expect(webTotalCoins(1300)).toBe(1430);
  });
  it("rounds the bonus to the nearest coin", () => {
    // 99 * 10% = 9.9 -> rounds to 10
    expect(webBonusCoins(99)).toBe(10);
    expect(webTotalCoins(99)).toBe(109);
  });
  it("each pack's web total is base + 10%", () => {
    for (const p of COIN_PACKS) {
      expect(webTotalCoins(p.coins)).toBe(p.coins + Math.round(p.coins * 0.1));
    }
  });
});

describe("isFreeEpisode — first 10 free", () => {
  it("episodes 1..10 are free", () => {
    for (let n = 1; n <= 10; n++) expect(isFreeEpisode(n)).toBe(true);
  });
  it("episode 11 and beyond are locked", () => {
    expect(isFreeEpisode(11)).toBe(false);
    expect(isFreeEpisode(72)).toBe(false);
  });
});

describe("series model", () => {
  it("loads all 14 Katha-original series with ranks", () => {
    expect(SERIES).toHaveLength(14);
    expect(SERIES[0].rank).toBe(1);
    expect(SERIES[13].rank).toBe(14);
  });

  it("maps episodes with free/paid flags and applies presentation overlay", () => {
    const s = SERIES[0];
    expect(s.episodes.length).toBe(s.episodeCount);
    expect(s.episodes[0].isFree).toBe(true);
    expect(typeof s.c1).toBe("string");
    expect(typeof s.language).toBe("string");
    expect(s.rating).toMatch(/U\/A/);
  });

  it("takes rating and language from the seed, not the presentation overlay", () => {
    // kaanch-ka-mahal has no PRESENTATION entry: colors fall back, but the
    // rating/language come from the catalog itself (it is U/A 13+, not 16+).
    const s = getSeries("kaanch-ka-mahal")!;
    expect(s).toBeDefined();
    expect(s.language).toBe("Hindi");
    expect(s.rating).toBe("U/A 13+");
    expect(s.c1).toBe("#1D1A2F");
  });

  it("getSeries returns undefined for an unknown slug", () => {
    expect(getSeries("no-such-series")).toBeUndefined();
  });

  it("allSlugs returns every slug", () => {
    const slugs = allSlugs();
    expect(slugs).toHaveLength(14);
    expect(slugs).toContain("kaanch-ka-mahal");
    expect(slugs).toContain("ceo-sahab");
  });
});

describe("bundle + locked pricing", () => {
  const mk = (episodeCount: number): Series => ({
    slug: "x",
    title: "X",
    synopsis: "",
    genres: [],
    tropes: [],
    episodeCount,
    language: "Hindi",
    rating: "U/A 16+",
    c1: "#000",
    c2: "#fff",
    rank: 1,
    episodes: [],
  });

  it("fullLockedCost = (episodes - 10) * 30", () => {
    // ceo-sahab: 72 eps -> 62 locked * 30 = 1860
    expect(fullLockedCost(mk(72))).toBe(1860);
    // kaanch-ka-mahal: 60 -> 50 locked * 30 = 1500
    expect(fullLockedCost(mk(60))).toBe(1500);
  });

  it("bundleCost applies 25% off with floor via round", () => {
    // 62 locked * 30 = 1860, 25% off -> 1395
    expect(bundleCost(mk(72))).toBe(1395);
    // 50 * 30 = 1500 -> 1125
    expect(bundleCost(mk(60))).toBe(1125);
  });

  it("bundle is always cheaper than buying locked episodes individually", () => {
    for (const s of SERIES) {
      expect(bundleCost(s)).toBeLessThan(fullLockedCost(s));
    }
  });

  it("clamps to zero when there are fewer than 10 episodes", () => {
    expect(fullLockedCost(mk(8))).toBe(0);
    expect(bundleCost(mk(8))).toBe(0);
  });
});

describe("fmt", () => {
  it("thousands-separates with the Indian grouping", () => {
    expect(fmt(1300)).toBe("1,300");
    expect(fmt(16000)).toBe("16,000");
    expect(fmt(0)).toBe("0");
  });
});

describe("coverUrl", () => {
  it("builds portrait and billboard media URLs off the API base", async () => {
    const { coverUrl, API_BASE } = await import("../lib/catalog");
    expect(coverUrl("kaanch-ka-mahal")).toBe(
      `${API_BASE}/media/kaanch-ka-mahal/cover_9x16.jpg`);
    expect(coverUrl("kaanch-ka-mahal", true)).toBe(
      `${API_BASE}/media/kaanch-ka-mahal/cover_16x9.jpg`);
  });
});

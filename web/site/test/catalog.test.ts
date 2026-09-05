import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FREE_EPISODES,
  EPISODE_COIN_PRICE,
  BUNDLE_DISCOUNT_PCT,
  RUPEES_PER_COIN,
  COIN_PACKS,
  PACK_PRESENTATION,
  SERIES,
  coinsToRupees,
  isFreeEpisode,
  bundleCost,
  fullLockedCost,
  getSeries,
  allSlugs,
  fmt,
  clock,
  countLabel,
  jsonLdString,
  type Series,
} from "@/lib/catalog";

describe("pricing constants", () => {
  it("mirrors the ledger pricing profile", () => {
    expect(FREE_EPISODES).toBe(10);
    expect(EPISODE_COIN_PRICE).toBe(30);
    expect(BUNDLE_DISCOUNT_PCT).toBe(25);
    expect(RUPEES_PER_COIN).toBe(0.15);
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

describe("pack presentation", () => {
  it("maps every product SKU to its store name and badge, and nothing numeric", () => {
    expect(Object.keys(PACK_PRESENTATION)).toHaveLength(5);
    expect(PACK_PRESENTATION["coins_popular_in"]).toMatchObject({ name: "Popular", highlight: true });
    expect(PACK_PRESENTATION["coins_starter_in"].gold).toBe(true);
    expect("coins" in PACK_PRESENTATION["coins_starter_in"]).toBe(false);
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
  it("loads all 14 Katha-original series", () => {
    expect(SERIES).toHaveLength(14);
    expect(SERIES.map((s) => s.slug)).toContain("nalugu-ghantalu");
  });

  it("maps episodes with free/paid flags and applies presentation overlay", () => {
    const s = SERIES[0];
    expect(s.episodes.length).toBe(s.episodeCount);
    expect(s.episodes[0].isFree).toBe(true);
    expect(typeof s.c1).toBe("string");
    expect(typeof s.language).toBe("string");
    expect(s.rating).toMatch(/U\/A/);
  });

  it("takes rating and language from the seed, and key art from the slug", () => {
    const s = getSeries("kaanch-ka-mahal")!;
    expect(s).toBeDefined();
    expect(s.language).toBe("Hindi");
    expect(s.rating).toBe("U/A 13+");
    expect(s.c1).toBe("#3A1F1A");
    expect(s.c2).toBe("#C2553D");
  });

  it("every seed slug has its own key art — none falls back to one shared gradient", () => {
    // The old PRESENTATION map was keyed by slugs that no longer exist, so all
    // 14 titles rendered the same purple. Every slug must be covered, and the
    // gradients must not collapse to a single pair.
    const pairs = new Set(SERIES.map((s) => `${s.c1}/${s.c2}`));
    expect(pairs.size).toBeGreaterThanOrEqual(10);
    expect(SERIES.every((s) => s.c1 !== "#1D1A2F")).toBe(true);
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

describe("countLabel + clock", () => {
  it("agrees the noun with its number", () => {
    expect(countLabel(0, "person", "people")).toBe("0 people");
    expect(countLabel(1, "person", "people")).toBe("1 person");
    expect(countLabel(2, "person", "people")).toBe("2 people");
    expect(countLabel(1200, "series", "series")).toBe("1,200 series");
  });

  it("renders a playback position as a clock, and an unknown one as 0:00", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(7.4)).toBe("0:07");
    expect(clock(23)).toBe("0:23");
    expect(clock(64)).toBe("1:04");
    expect(clock(301.08)).toBe("5:01");
    expect(clock(3723)).toBe("1:02:03");
    expect(clock(NaN)).toBe("0:00");
    expect(clock(Infinity)).toBe("0:00");
    expect(clock(-5)).toBe("0:00");
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


describe("jsonLdString", () => {
  it("escapes '<' so a value can never close the inline script element", () => {
    const out = jsonLdString({ name: "</script><img src=x onerror=1>" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script>");
    expect(JSON.parse(out).name).toBe("</script><img src=x onerror=1>");
  });
});

describe("origins (S7)", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("dev/test talk to the local core-api; production is same-origin with absolute og images", async () => {
    const dev = await import("@/lib/catalog");
    expect(dev.API_BASE).toBe("http://localhost:8799");
    expect(dev.coverUrl("s")).toBe("http://localhost:8799/media/s/cover_9x16.jpg");
    expect(dev.ogImageUrl("s")).toBe("http://localhost:8799/media/s/og_1200x630.jpg");

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_ORIGIN", "https://qa.katha.example");
    vi.resetModules();
    const prod = await import("@/lib/catalog");
    expect(prod.API_BASE).toBe("");                                   // relative: nothing baked in
    expect(prod.coverUrl("s", true)).toBe("/media/s/cover_16x9.jpg");
    expect(prod.ogImageUrl("s")).toBe("https://qa.katha.example/media/s/og_1200x630.jpg");
    const api = await import("@/lib/api");
    expect(api.api.base).toBe("");

    vi.stubEnv("NEXT_PUBLIC_SITE_ORIGIN", "");
    vi.stubEnv("NEXT_PUBLIC_API_BASE", "https://api.katha.example");
    vi.resetModules();
    const split = await import("@/lib/catalog");
    expect(split.ogImageUrl("s")).toBe("https://api.katha.example/media/s/og_1200x630.jpg");
  });
});

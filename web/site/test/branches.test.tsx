/** Site branch sweep: seed-mapping fallbacks, storage-hostile browsers,
 * empty-name avatars and the player's bad-episode fallback. */
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@/lib/seed_catalog.json");
});

describe("lib/api — storage-hostile browsers", () => {
  it("token helpers survive a throwing localStorage", async () => {
    const { getToken, clearToken, api } = await import("@/lib/api");
    for (const m of ["getItem", "setItem", "removeItem"] as const) {
      vi.spyOn(Storage.prototype, m).mockImplementation(() => {
        throw new Error("blocked");
      });
    }
    expect(getToken()).toBeNull();
    expect(() => clearToken()).not.toThrow();
    // the private setToken catch rides the login path
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "tok", user: { user_id: "u" } }),
    }));
    await expect(api.guestLogin()).resolves.toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe("lib/catalog — sparse seed rows fall back", () => {
  it("missing genres/tropes/episodes, unknown language, no rating", async () => {
    vi.doMock("@/lib/seed_catalog.json", () => ({
      default: {
        _meta: { pricing_profile: { free_episode_count: 10,
                                    episode_coin_price: 30,
                                    bundle_discount_pct: 25 } },
        series: [{ slug: "bare-min", title: "Bare", synopsis: "x",
                   episode_count: 0, primary_language: "bho" }],
      },
    }));
    const { SERIES } = await import("@/lib/catalog");
    const s = SERIES.find((x) => x.slug === "bare-min")!;
    expect(s.genres).toEqual([]);
    expect(s.tropes).toEqual([]);
    expect(s.episodes).toEqual([]);
    expect(s.language).toBe("Hindi");    // FALLBACK_PRES.language
    expect(s.rating).toBe("U/A 16+");    // FALLBACK_PRES.rating
  });
});

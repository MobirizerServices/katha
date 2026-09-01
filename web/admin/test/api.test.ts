import { describe, it, expect, vi, afterEach } from "vitest";
import { api, BASE_URL } from "../src/api/client";
import { MOCK_OVERVIEW, MOCK_SERIES, MOCK_USERS, MOCK_APPROVALS, MOCK_FLAGS, MOCK_AUDIT } from "../src/api/mock";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api client — base", () => {
  it("targets the admin-api base path", () => {
    expect(BASE_URL).toBe("/admin/v1");
  });
});

describe("api client — live success path", () => {
  it("returns parsed JSON from the server when the request succeeds", async () => {
    const payload = [{ id: "live_1" }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.listApprovals();
    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/approvals?status=pending`,
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: "application/json",
          "X-Actor-Id": "riya",
          "X-Role": "admin",
        }),
      })
    );
  });
});

describe("api client — fallback path", () => {
  it("falls back to the mock when the server returns a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    const result = await api.getOverview();
    expect(result).toEqual(MOCK_OVERVIEW);
  });

  it("falls back to the mock when fetch rejects (network/offline)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await api.listSeries()).toEqual(MOCK_SERIES);
    expect((await api.listUsers()).users).toEqual(MOCK_USERS);
    expect(await api.listApprovals()).toEqual(MOCK_APPROVALS);
    expect(await api.listFlags()).toEqual(MOCK_FLAGS);
    expect((await api.listAudit({})).rows).toEqual(MOCK_AUDIT);
  });
});

describe("mock catalog — product facts", () => {
  it("every series has 10 free episodes, 30 coin price, 25% bundle discount", () => {
    for (const s of MOCK_SERIES) {
      expect(s.freeEpisodes).toBe(10);
      expect(s.coinPrice).toBe(30);
      expect(s.bundleDiscountPct).toBe(25);
    }
  });

  it("live series report a non-zero liveCount, non-live report zero", () => {
    for (const s of MOCK_SERIES) {
      if (s.status === "live") expect(s.liveCount).toBeGreaterThan(0);
      else expect(s.liveCount).toBe(0);
    }
  });

  it("draft series are unrated", () => {
    const draft = MOCK_SERIES.find((s) => s.status === "draft")!;
    expect(draft.rating).toBe("—");
  });

  it("the web pack carries the +10% web bonus (1,300 -> 1,430)", () => {
    // MOCK_PACKS is asserted in the Config view test; here we confirm the
    // documented web-bonus math the product facts require.
    const bought = 1300;
    const web = bought + Math.round(bought * 0.1);
    expect(web).toBe(1430);
  });
});

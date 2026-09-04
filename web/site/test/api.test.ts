import { describe, it, expect, beforeEach, vi } from "vitest";
import { api, ApiError, getToken, clearToken } from "@/lib/api";

const TOKEN_KEY = "katha.token.v1";
const BASE = "http://localhost:8799";

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
function errResp(status: number, body: string) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

/** The [url, init] of the nth fetch call. */
function callArgs(n = 0): [string, RequestInit] {
  return fetchMock.mock.calls[n] as [string, RequestInit];
}
function headerOf(init: RequestInit, key: string): string | undefined {
  return (init.headers as Record<string, string>)[key];
}

describe("token storage helpers", () => {
  it("getToken reads the stored token; clearToken removes it", () => {
    expect(getToken()).toBeNull();
    localStorage.setItem(TOKEN_KEY, "abc");
    expect(getToken()).toBe("abc");
    clearToken();
    expect(getToken()).toBeNull();
  });
});

describe("guestLogin", () => {
  it("POSTs to /v1/auth/guest without a bearer and stores the token", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ access_token: "guest-tok" }));
    const tok = await api.guestLogin();
    expect(tok).toBe("guest-tok");
    expect(getToken()).toBe("guest-tok");

    const [url, init] = callArgs(0);
    expect(url).toBe(`${BASE}/v1/auth/guest`);
    expect(init.method).toBe("POST");
    // unauthenticated call: no Authorization header even if a token existed
    expect(headerOf(init, "Authorization")).toBeUndefined();
    expect(headerOf(init, "Content-Type")).toBe("application/json");
  });
});

describe("otpLogin", () => {
  it("verifies the code the viewer typed and stores the returned token", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ access_token: "otp-tok" }));
    const tok = await api.otpLogin("+91 99999 00000", "8642");
    expect(tok).toBe("otp-tok");
    expect(getToken()).toBe("otp-tok");
    const [verUrl, verInit] = callArgs(0);
    expect(verUrl).toBe(`${BASE}/v1/auth/otp/verify`);
    expect(JSON.parse(verInit.body as string)).toEqual({ phone: "+91 99999 00000", code: "8642" });
  });

  it("sends the guest bearer on verify so the server merges the wallet", async () => {
    localStorage.setItem(TOKEN_KEY, "guest-tok");
    fetchMock.mockResolvedValueOnce(okJson({ access_token: "member-tok" }));
    await api.otpLogin("+91 2", "1111");
    const headers = callArgs(0)[1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer guest-tok");
    expect(getToken()).toBe("member-tok"); // guest token replaced after merge
  });

  it("a rejected code surfaces as an ApiError, leaving the guest token in place", async () => {
    localStorage.setItem(TOKEN_KEY, "guest-tok");
    fetchMock.mockResolvedValueOnce(errResp(401, "incorrect or expired code"));
    await expect(api.otpLogin("+91 2", "0000")).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe("guest-tok");
  });
});

describe("authenticated endpoints attach the bearer", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "session-tok");
  });

  it("wallet() GETs /v1/wallet with Authorization", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ balance_bought: 40, balance_bonus: 60, total: 100 }));
    const w = await api.wallet();
    expect(w.total).toBe(100);
    const [url, init] = callArgs(0);
    expect(url).toBe(`${BASE}/v1/wallet`);
    expect(headerOf(init, "Authorization")).toBe("Bearer session-tok");
  });

  it("webOrder() POSTs the sku to /v1/web/orders", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ balance_bought: 1300, balance_bonus: 130, total: 1430 }));
    const w = await api.webOrder("coins_popular_in");
    expect(w.total).toBe(1430);
    const [url, init] = callArgs(0);
    expect(url).toBe(`${BASE}/v1/web/orders`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ sku: "coins_popular_in", email: "" });
    expect(headerOf(init, "Authorization")).toBe("Bearer session-tok");
  });

  it("unlockEpisode() hits the per-episode unlock path with the idempotency key", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ wallet: { balance_bought: 10, balance_bonus: 0, total: 10 }, spent_bonus: 20, spent_bought: 10 })
    );
    const r = await api.unlockEpisode("ceo-sahab", 11, "key-1");
    expect(r.spent_bonus).toBe(20);
    const [url, init] = callArgs(0);
    expect(url).toBe(`${BASE}/v1/series/ceo-sahab/episodes/11/unlock`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ idempotency_key: "key-1" });
    expect(headerOf(init, "Authorization")).toBe("Bearer session-tok");
  });

  it("unlockAll() hits the unlock-all path", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ wallet: { balance_bought: 0, balance_bonus: 0, total: 0 }, episode_ids: ["e11", "e12"] })
    );
    const r = await api.unlockAll("ceo-sahab", "bundle-key");
    expect(r.episode_ids).toEqual(["e11", "e12"]);
    const [url, init] = callArgs(0);
    expect(url).toBe(`${BASE}/v1/series/ceo-sahab/unlock-all`);
    expect(JSON.parse(init.body as string)).toEqual({ idempotency_key: "bundle-key" });
  });

  it("playback() POSTs to the playback path", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ locked: false, url: "signed://x" }));
    const r = await api.playback("ceo-sahab", 3);
    expect(r.locked).toBe(false);
    const [url, init] = callArgs(0);
    expect(url).toBe(`${BASE}/v1/series/ceo-sahab/episodes/3/playback`);
    expect(init.method).toBe("POST");
    expect(headerOf(init, "Authorization")).toBe("Bearer session-tok");
  });
});

describe("error handling", () => {
  it("throws ApiError carrying status + body on a non-2xx response", async () => {
    localStorage.setItem(TOKEN_KEY, "t");
    fetchMock.mockResolvedValueOnce(errResp(402, "insufficient funds"));
    await expect(api.wallet()).rejects.toBeInstanceOf(ApiError);
    fetchMock.mockResolvedValueOnce(errResp(402, "insufficient funds"));
    try {
      await api.wallet();
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as ApiError;
      expect(err.status).toBe(402);
      expect(err.body).toBe("insufficient funds");
      expect(err.message).toContain("402");
    }
  });

  it("omits Authorization when no token is stored on an auth endpoint", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ balance_bought: 0, balance_bonus: 0, total: 0 }));
    await api.wallet();
    expect(headerOf(callArgs(0)[1], "Authorization")).toBeUndefined();
  });

  it("exposes the configured base url", () => {
    expect(api.base).toBe(BASE);
  });
});


describe("profile, packs, config, playback", () => {
  it("me() reads the signed profile with the bearer", async () => {
    localStorage.setItem(TOKEN_KEY, "tok");
    fetchMock.mockResolvedValueOnce(okJson({ user_id: "u", kind: "phone", display_name: "Asha",
                                             language: "hi", phone: "+91 1" }));
    const me = await api.me();
    expect(me.kind).toBe("phone");
    const [url, init] = callArgs(0);
    expect(url).toBe(`${BASE}/v1/me`);
    expect(headerOf(init, "Authorization")).toBe("Bearer tok");
  });

  it("packs() and config() are public reads of the IN storefront and pricing facts", async () => {
    localStorage.setItem(TOKEN_KEY, "tok");
    fetchMock.mockResolvedValueOnce(okJson([{ sku: "coins_popular_in", coins: 1300, web_bonus_coins: 130 }]));
    const packs = await api.packs();
    expect(packs[0].web_bonus_coins).toBe(130);
    expect(callArgs(0)[0]).toBe(`${BASE}/v1/iap/packs?storefront=IN`);
    expect(headerOf(callArgs(0)[1], "Authorization")).toBeUndefined();
    fetchMock.mockResolvedValueOnce(okJson({ episode_coin_price: 30, coin_rupee_rate: 0.15 }));
    const cfg = await api.config();
    expect(cfg.episode_coin_price).toBe(30);
    expect(callArgs(1)[0]).toBe(`${BASE}/v1/config`);
  });

  it("otpRequest sends the phone without a bearer; otpLogin sends the typed code with it", async () => {
    localStorage.setItem(TOKEN_KEY, "guest");
    fetchMock.mockResolvedValueOnce(okJson({ request_id: "r" }));
    await api.otpRequest("+91 2");
    expect(JSON.parse(callArgs(0)[1].body as string)).toEqual({ phone: "+91 2" });
    expect(headerOf(callArgs(0)[1], "Authorization")).toBeUndefined();
    fetchMock.mockResolvedValueOnce(okJson({ access_token: "member" }));
    await api.otpLogin("+91 2", "4321");
    expect(JSON.parse(callArgs(1)[1].body as string)).toEqual({ phone: "+91 2", code: "4321" });
    expect(headerOf(callArgs(1)[1], "Authorization")).toBe("Bearer guest");
    expect(getToken()).toBe("member");
  });

  it("playback returns the server's locked payload verbatim", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ locked: true, episode_id: "s:e11", price_coins: 45,
                                             balance: 10, remaining_locked: 3, bundle_offer_coins: 101 }));
    const pb = await api.playback("s", 11);
    expect(pb.locked && pb.bundle_offer_coins).toBe(101);
    expect(callArgs(0)[0]).toBe(`${BASE}/v1/series/s/episodes/11/playback`);
  });
});


describe("webOrder payment id", () => {
  it("sends order_ref when a payment id is given, and omits it otherwise", async () => {
    localStorage.setItem(TOKEN_KEY, "tok");
    fetchMock.mockResolvedValue(okJson({ balance_bought: 0, balance_bonus: 0, total: 0 }));
    await api.webOrder("coins_popular_in", "a@b.c", "pay_123");
    expect(JSON.parse(callArgs(0)[1].body as string)).toEqual(
      { sku: "coins_popular_in", email: "a@b.c", order_ref: "pay_123" });
    await api.webOrder("coins_popular_in");
    expect(JSON.parse(callArgs(1)[1].body as string)).toEqual({ sku: "coins_popular_in", email: "" });
  });
});

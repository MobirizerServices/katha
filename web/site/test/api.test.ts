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
  it("requests then verifies the OTP and stores the returned token", async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({})) // otp/request
      .mockResolvedValueOnce(okJson({ access_token: "otp-tok" })); // otp/verify

    const tok = await api.otpLogin("+91 99999 00000");
    expect(tok).toBe("otp-tok");
    expect(getToken()).toBe("otp-tok");

    const [reqUrl, reqInit] = callArgs(0);
    expect(reqUrl).toBe(`${BASE}/v1/auth/otp/request`);
    expect(JSON.parse(reqInit.body as string)).toEqual({ phone: "+91 99999 00000" });

    const [verUrl, verInit] = callArgs(1);
    expect(verUrl).toBe(`${BASE}/v1/auth/otp/verify`);
    // default code is 1234
    expect(JSON.parse(verInit.body as string)).toEqual({ phone: "+91 99999 00000", code: "1234" });
  });

  it("sends the guest bearer on verify so the server merges the wallet", async () => {
    localStorage.setItem(TOKEN_KEY, "guest-tok");
    fetchMock
      .mockResolvedValueOnce(okJson({})) // otp/request
      .mockResolvedValueOnce(okJson({ access_token: "member-tok" }));
    await api.otpLogin("+91 2");
    const headers = callArgs(1)[1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer guest-tok");
    expect(getToken()).toBe("member-tok"); // guest token replaced after merge
  });

  it("passes a custom OTP code through to verify", async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({}))
      .mockResolvedValueOnce(okJson({ access_token: "t" }));
    await api.otpLogin("+91 1", "9999");
    expect(JSON.parse(callArgs(1)[1].body as string)).toEqual({ phone: "+91 1", code: "9999" });
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

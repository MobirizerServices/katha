import { describe, it, expect, beforeEach, vi } from "vitest";
import { api, getToken } from "@/lib/api";
import { summary } from "./walletStub";

const TOKEN_KEY = "katha.token.v1";
const BASE = "http://localhost:8799";

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(TOKEN_KEY, "session-tok");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

function callArgs(n = 0): [string, RequestInit] {
  return fetchMock.mock.calls[n] as [string, RequestInit];
}
const auth = (init: RequestInit) => (init.headers as Record<string, string>)["Authorization"];

describe("search — public catalog search", () => {
  it("GETs /v1/search?q= without a bearer, and narrows by lang when given", async () => {
    fetchMock.mockResolvedValue(okJson({ query: "ceo", series: [summary("ceo-sahab")], people: [] }));
    const r = await api.search("ceo sahab");
    expect(r.series[0].slug).toBe("ceo-sahab");
    let [url, init] = callArgs(0);
    expect(url).toBe(`${BASE}/v1/search?q=ceo+sahab`);
    expect(auth(init)).toBeUndefined();

    await api.search("ceo", "ta");
    [url] = callArgs(1);
    expect(url).toBe(`${BASE}/v1/search?q=ceo&lang=ta`);
  });
});

describe("my list + reminders — the server keeps the list", () => {
  it("reads, adds and removes list entries with the bearer", async () => {
    fetchMock.mockResolvedValue(okJson({ slugs: ["ceo-sahab"], series: [summary("ceo-sahab")] }));
    expect((await api.myList()).slugs).toEqual(["ceo-sahab"]);
    await api.addToList("ceo-sahab");
    await api.removeFromList("ceo-sahab");
    expect(callArgs(0)[0]).toBe(`${BASE}/v1/me/list`);
    expect(callArgs(1)[0]).toBe(`${BASE}/v1/me/list/ceo-sahab`);
    expect(callArgs(1)[1].method).toBe("PUT");
    expect(callArgs(2)[1].method).toBe("DELETE");
    expect(auth(callArgs(0)[1])).toBe("Bearer session-tok");
  });

  it("reads, sets and clears reminders", async () => {
    fetchMock.mockResolvedValue(okJson({ slugs: ["ceo-sahab"] }));
    expect((await api.reminders()).slugs).toEqual(["ceo-sahab"]);
    await api.addReminder("ceo-sahab");
    await api.removeReminder("ceo-sahab");
    expect(callArgs(0)[0]).toBe(`${BASE}/v1/me/reminders`);
    expect(callArgs(1)[0]).toBe(`${BASE}/v1/me/reminders/ceo-sahab`);
    expect(callArgs(1)[1].method).toBe("PUT");
    expect(callArgs(2)[1].method).toBe("DELETE");
  });
});

describe("account actions", () => {
  it("signOutDevices POSTs and replaces the stored token with the fresh one", async () => {
    const user = { user_id: "m", kind: "phone", display_name: "Asha", language: "hi", phone: "+91 1" };
    fetchMock.mockResolvedValue(okJson({ access_token: "fresh-tok", token_type: "bearer", user }));
    const me = await api.signOutDevices();
    expect(me.display_name).toBe("Asha");
    expect(getToken()).toBe("fresh-tok");
    const [url, init] = callArgs(0);
    expect(url).toBe(`${BASE}/v1/me/signout-devices`);
    expect(init.method).toBe("POST");
    expect(auth(init)).toBe("Bearer session-tok");   // sent under the OLD token
  });

  it("updateMe PATCHes /v1/me; deleteMe DELETEs it", async () => {
    fetchMock.mockResolvedValue(okJson({ user_id: "m", kind: "phone", display_name: "Asha", language: "ta", phone: null }));
    expect((await api.updateMe({ language: "ta" })).language).toBe("ta");
    expect(callArgs(0)[0]).toBe(`${BASE}/v1/me`);
    expect(callArgs(0)[1].method).toBe("PATCH");
    expect(JSON.parse(callArgs(0)[1].body as string)).toEqual({ language: "ta" });
    fetchMock.mockResolvedValue(okJson({ deleted: true }));
    await api.deleteMe();
    expect(callArgs(1)[0]).toBe(`${BASE}/v1/me`);
    expect(callArgs(1)[1].method).toBe("DELETE");
  });
});

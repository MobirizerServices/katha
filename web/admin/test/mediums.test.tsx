/** Review Mediums W1–W7: session-loss handling, honest approval toasts,
 *  single-flight mutations, INR formatting, same-origin bases, idempotent
 *  adjustments, CSV formula neutralization. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { api, send, onUnauthorized, isOnline } from "../src/api/client";
import { Approvals } from "../src/views/Approvals";
import { CatalogDetail } from "../src/views/CatalogDetail";
import { Users } from "../src/views/Users";
import { Audit } from "../src/views/Audit";
import { renderWithStore, getStore } from "./helpers";

type Handler = (init?: RequestInit) => unknown;
type Stub = Record<string, Handler | { status: number; body: unknown; headers?: Record<string, string> }>;

function stub(routes: Stub) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    for (const [needle, r] of Object.entries(routes)) {
      if (String(url).includes(needle)) {
        if (typeof r === "function") return Promise.resolve({ ok: true, status: 200, json: async () => r(init) });
        return Promise.resolve({
          ok: r.status < 400, status: r.status, json: async () => r.body,
          headers: { get: (k: string) => r.headers?.[k] ?? null },
        });
      }
    }
    return Promise.reject(new Error("offline"));
  }));
  return calls;
}
const SIGNALS: Stub = {
  // the sidebar badge/Finance counter poll the inbox with every signal read
  "/approvals?": () => [],
  "/health/full": () => ({ status: "ok", checks: {}, at: "" }),
  "/auth/me": () => ({ mode: "headers", authenticated: true }),
  "/attention": () => ({ items: [] }),
  "/audit": () => ({ rows: [], chain_ok: true, total: 0 }),
  "/config/flags": () => [],
};
async function online() {
  act(() => getStore().refreshSignals());
  await waitFor(() => expect(getStore().online).toBe(true));
}
const DETAIL = {
  slug: "kaanch-ka-mahal", title: "Kaanch Ka Mahal", synopsis: "s", genres: ["Drama"],
  language: "Hindi", episodeCount: 60, freeEpisodes: 10, coinPrice: 30, bundleDiscountPct: 25,
  status: "live", rating: "U/A 13+", ratingHistory: {}, updatedAt: "", coverUrl: "x",
  pricingOverridden: false, rights: { owner: "Katha Originals", license_until: "" },
  media: { covers_ok: true, episodes_with_media: 60, episodes_missing: 0 },
  episodes: [{ number: 1, title: "One", isFree: true, hasMedia: true }], previewWeb: "http://x/w",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("client — a reachable server's errors are never dressed as sample data (W1)", () => {
  it("a body that is not JSON returns the empty shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }));
    expect(await api.listSeries()).toEqual([]);
    expect(isOnline()).toBe(true);
  });

  it("403 notifies like 401; 500 does not; a step-up demand carries its login URL", async () => {
    const seen: number[] = [];
    const off = onUnauthorized((s) => seen.push(s));
    stub({ "zz-alpha": { status: 403, body: { detail: "step-up required" },
                         headers: { "X-Katha-Login": "/admin/v1/auth/login?step_up=1" } },
           "zz-beta": { status: 500, body: {} } });
    const a = await send("/zz-alpha", "POST", {});
    const b = await send("/zz-beta", "POST", {});
    off();
    expect(seen).toEqual([403]);
    expect(a).toMatchObject({ error: "step-up required", httpStatus: 403, login: "/admin/v1/auth/login?step_up=1" });
    expect(b).toMatchObject({ error: "HTTP 500", httpStatus: 500 });
  });

  it("MEDIA_BASE and BASE_URL honour the build-time env", async () => {
    vi.stubEnv("VITE_MEDIA_BASE", "https://qa.katha.example");
    vi.stubEnv("VITE_ADMIN_API_BASE", "https://admin.example/admin/v1");
    vi.resetModules();
    const mod = await import("../src/api/client");
    expect(mod.MEDIA_BASE).toBe("https://qa.katha.example");
    expect(mod.BASE_URL).toBe("https://admin.example/admin/v1");
  });
});

describe("store — who am I", () => {
  it("me is the OIDC email when signed in through OIDC", async () => {
    stub({ ...SIGNALS, "/auth/me": () => ({ mode: "oidc", authenticated: true,
                                             email: "farah@katha.example", role: "finance" }),
           "/approvals": () => [] });
    renderWithStore(<Approvals />);
    await waitFor(() => expect(getStore().me).toBe("farah@katha.example"));
    expect(getStore().role).toBe("finance");
  });
});

describe("Approvals — the toast says what happened (W2)", () => {
  it("an approve that never reached the server says so; a bulk reject counts its successes", async () => {
    renderWithStore(<Approvals />);
    await waitFor(() => expect(getStore().approvals.length).toBeGreaterThan(0));
    const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      // the inbox re-reads on every signal refresh now (ADM-03): serve back
      // whatever the queue currently holds instead of emptying it
      if (u.includes("/approvals?status=pending")) return ok(getStore().approvals);
      if (u.includes("/reject")) return ok({ status: "rejected" });
      return Promise.reject(new Error("offline"));            // /approve: network gone
    }));
    await online();
    const rows = screen.getAllByRole("listitem");
    const first = rows.find((r) => within(r).queryByText("Approve"))!;
    fireEvent.click(within(first).getByText("Approve"));
    await waitFor(() => expect(getStore().toasts.some((t) => t.text === "Offline — nothing was decided")).toBe(true));
    expect(getStore().toasts.some((t) => t.text.includes("written to the ledger"))).toBe(false);
    await online();
    // an offline attempt resolves locally (the row leaves the inbox); queue two more
    act(() => {
      for (const id of ["apr_x1", "apr_x2"]) getStore().addApproval({
        id, kind: "Coin adjustment", detail: `${id} · 800`, requestedBy: "Farah Khan",
        when: "2026-09-01T00:00:00+00:00", needs: "Finance", amount: 800, userId: "u1" });
    });
    screen.getAllByRole("checkbox").slice(0, 2).forEach((b) => fireEvent.click(b));
    fireEvent.click(screen.getByText(/Reject 2 with one note/));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: "bulk" } });
    fireEvent.click(within(dialog).getByText("Reject with note"));
    await waitFor(() => expect(getStore().toasts.some((t) => t.text.startsWith("Rejected 2 requests"))).toBe(true));
  });
});

describe("CatalogDetail — one mutation in flight (W3)", () => {
  it("a repeat push is refused with the server's reason; a double click sends once", async () => {
    let n = 0;
    stub({ ...SIGNALS, "/approvals": () => [],
      "/catalog/series/kaanch-ka-mahal": () => DETAIL });
    const real = globalThis.fetch as ReturnType<typeof vi.fn>;
    const impl = real.getMockImplementation()!;
    real.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("/notify-drop")) {
        n += 1;
        return new Promise((resolve) => setTimeout(() => resolve(
          n === 1 ? { ok: true, status: 200, json: async () => ({ devices: 2 }) }
                  : { ok: false, status: 409, json: async () => ({ detail: "already pushed at t0" }),
                      headers: { get: () => null } }), 20));
      }
      return impl(url, init);
    });
    renderWithStore(<Routes><Route path="/catalog/:slug" element={<CatalogDetail />} /></Routes>,
                    { route: "/catalog/kaanch-ka-mahal" });
    await screen.findByText("Kaanch Ka Mahal");
    await online();
    fireEvent.click(screen.getByText("Notify drop…"));
    const dlg = await screen.findByRole("dialog");
    const btn = within(dlg).getByText("Send push");
    fireEvent.click(btn);
    fireEvent.click(btn);                       // ignored while the first is in flight
    await waitFor(() => expect(getStore().toasts.some((t) => t.text.includes("pushed to 2 device(s)"))).toBe(true));
    expect(n).toBe(1);
    fireEvent.click(screen.getByText("Notify drop…"));
    const dlg2 = await screen.findByRole("dialog");
    fireEvent.click(within(dlg2).getByText("Send push"));
    await waitFor(() => expect(getStore().toasts.some((t) => t.text === "Not sent again: already pushed at t0")).toBe(true));
  });
});

describe("Users — adjustments carry an idempotency key (W6)", () => {
  it("every submit sends a per-attempt key", async () => {
    renderWithStore(<Users />);
    await waitFor(() => expect(screen.getByText("Meera K.")).toBeInTheDocument());
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("/wallet/adjust")) {
        bodies.push(JSON.parse(String(init?.body)));
        return Promise.resolve({ ok: true, status: 200, json: async () =>
          ({ status: "applied", ref: "adjust:k", wallet: { total: 1330 } }) });
      }
      return Promise.reject(new Error("offline"));
    }));
    fireEvent.click(screen.getByText("Adjust coins…"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("Write ledger entry"));
    await waitFor(() => expect(within(dialog).getByText("adjust:k")).toBeInTheDocument());
    expect(typeof bodies[0].idempotency_key).toBe("string");
    expect(String(bodies[0].idempotency_key).length).toBeGreaterThan(4);
  });
});

describe("Audit — CSV cells cannot be formulas (W7)", () => {
  it("prefixes =, +, -, @ cells with an apostrophe", async () => {
    stub({ ...SIGNALS, "/approvals": () => [],
      "/audit": () => ({ rows: [
        { id: 1, ts: "2026-09-01T00:00:00Z", actor: "riya", action: "note", entity: "=HYPERLINK(\"x\")", change: "+1+cmd|calc", ip: "" },
        { id: 2, ts: "2026-09-01T00:00:00Z", actor: "@riya", action: "note", entity: "e", change: "-2", ip: "" }],
        chain_ok: true, total: 2 }) });
    // jsdom's Blob cannot be read back; capture the parts it was built from.
    let csv = "";
    vi.stubGlobal("Blob", class { constructor(parts: string[]) { csv = parts.join(""); } });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    try {
      renderWithStore(<Audit />);
      await online();
      await waitFor(() => expect(screen.getByText('=HYPERLINK("x")')).toBeInTheDocument(), { timeout: 3000 });
      fireEvent.click(screen.getByText(/Export CSV/));
      const text = csv;
      expect(text).toContain('"\'=HYPERLINK(""x"")"');
      expect(text).toContain('"\'+1+cmd|calc"');
      expect(text).toContain('"\'@riya"');
      expect(text).toContain('"\'-2"');
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }
  });
});

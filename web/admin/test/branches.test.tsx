/** Branch-coverage sweep: the server-refusal paths, permission-denied
 * renders, boundary chips and fallback ternaries that only fire when
 * something goes sideways. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act, within, render } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { Overview } from "../src/views/Overview";
import { Users } from "../src/views/Users";
import { Catalog } from "../src/views/Catalog";
import { CatalogDetail } from "../src/views/CatalogDetail";
import { Config } from "../src/views/Config";
import { Grievances } from "../src/views/Grievances";
import { Audit } from "../src/views/Audit";
import { Access } from "../src/views/Access";
import { Approvals } from "../src/views/Approvals";
import { Sidebar } from "../src/Sidebar";
import { Spark } from "../src/ui";
import { api, send } from "../src/api/client";
import { renderWithStore, getStore } from "./helpers";

type Stub = Record<string, (init?: RequestInit) => unknown>;

function stub(routes: Stub, failRest = true) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(
    (url: string, init?: RequestInit) => {
      for (const [needle, respond] of Object.entries(routes)) {
        if (String(url).includes(needle)) {
          const body = respond(init);
          if (body && typeof body === "object" && "__status" in (body as object)) {
            const b = body as { __status: number; detail?: string };
            return Promise.resolve({ ok: false, status: b.__status,
                                     json: async () => ({ detail: b.detail }) });
          }
          if (body && typeof body === "object" && "__hang" in (body as object)) {
            return new Promise(() => {});
          }
          return Promise.resolve({ ok: true, json: async () => body });
        }
      }
      return failRest
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ ok: true, json: async () => ({}) });
    }));
}

const SIGNALS: Stub = {
  "/health/full": () => ({ status: "ok", checks: {}, at: "" }),
  "/auth/me": () => ({ mode: "headers", authenticated: true }),
  "/attention": () => ({ items: [] }),
};

async function online() {
  act(() => getStore().refreshSignals());
  await waitFor(() => expect(getStore().online).toBe(true));
}

async function lastToastIncludes(text: string) {
  await waitFor(() => expect(getStore().toasts.some((t) =>
    t.text.includes(text))).toBe(true));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  document.cookie = "katha_admin_auth_note=; max-age=0; path=/";
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const DETAIL = {
  slug: "kaanch-ka-mahal", title: "Kaanch Ka Mahal", synopsis: "s",
  genres: ["Drama"], language: "Hindi", episodeCount: 2, freeEpisodes: 1,
  coinPrice: 30, bundleDiscountPct: 25, status: "qc-hold", rating: "U/A 13+",
  ratingHistory: { value: "U/A 13+", by: "dev", reason: "check" },
  updatedAt: "", coverUrl: "x", pricingOverridden: false,
  rights: { owner: "Katha Originals", license_until: "" },
  media: { covers_ok: true, episodes_with_media: 2, episodes_missing: 0 },
  episodes: [{ number: 1, title: "One", isFree: true, hasMedia: true }],
  previewWeb: "http://x/w",
};

describe("CatalogDetail — every mutation refusal surfaces", () => {
  function boot(errors: Stub) {
    stub({
      ...SIGNALS,
      ...errors,
      "/catalog/series/kaanch-ka-mahal": () => DETAIL,
    });
    renderWithStore(
      <Routes><Route path="/catalog/:slug" element={<CatalogDetail />} /></Routes>,
      { route: "/catalog/kaanch-ka-mahal" });
  }

  it("status, rating, pricing and rights errors become error toasts", async () => {
    boot({
      "/status": () => ({ __status: 403, detail: "qc may only take down" }),
      "/rating": () => ({ __status: 400, detail: "bad rating" }),
      "/pricing": () => ({ __status: 428, detail: "type the slug" }),
      "/rights": () => ({ __status: 400, detail: "bad date" }),
      "/episodes/1": () => ({ __status: 400, detail: "title too long" }),
    });
    // unknown status maps to the live badge (toBadge fallback)
    await screen.findByText("Kaanch Ka Mahal");
    // ratingHistory without an at renders the dash-less IsoTime fallback
    expect(screen.getByText(/Rated by/)).toBeInTheDocument();
    await online();
    fireEvent.click(screen.getByText("Publish (live)"));
    await lastToastIncludes("qc may only take down");
    fireEvent.click(screen.getByText("Change…"));
    let dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText(/Why/), { target: { value: "r" } });
    fireEvent.click(within(dlg).getByText("Save rating"));
    await lastToastIncludes("bad rating");
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByText("Reprice…"));
    dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Confirm slug"),
                     { target: { value: "kaanch-ka-mahal" } });
    fireEvent.click(within(dlg).getByText("Change pricing"));
    await lastToastIncludes("type the slug");
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByText("Edit…"));
    dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByText("Save rights"));
    await lastToastIncludes("bad date");
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getAllByText("Rename…")[0]);
    dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByText("Rename"));
    await lastToastIncludes("title too long");
  });

  it("offline mid-flight refusals stay honest for rating/pricing/rights/rename", async () => {
    boot({});
    await screen.findByText("Kaanch Ka Mahal");
    const steps: [string, (d: HTMLElement) => void, string, string][] = [
      ["Change…", (d) => fireEvent.change(within(d).getByLabelText(/Why/),
        { target: { value: "r" } }), "Save rating", "Offline — rating unchanged"],
      ["Reprice…", (d) => fireEvent.change(within(d).getByLabelText("Confirm slug"),
        { target: { value: "kaanch-ka-mahal" } }), "Change pricing",
       "Offline — pricing unchanged"],
      ["Edit…", () => {}, "Save rights", "Offline — rights unchanged"],
      ["Rename…", () => {}, "Rename", "Offline — title unchanged"],
    ];
    for (const [open, fill, save, toast] of steps) {
      boot({});                                     // network back up
      await online();
      fireEvent.click(screen.getAllByText(open)[0]);
      const dlg = await screen.findByRole("dialog");
      fill(dlg);
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
      fireEvent.click(within(dlg).getByText(save));
      await lastToastIncludes(toast);
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
  });
});

describe("Users — refusals, permissions and pending tabs", () => {
  const USER = {
    id: "u1", phone: "+91", name: "—", languages: "hi",
    wallet: { bought: 600, bonus: 0, unlocked: 2, ltv: "₹90" },
    lastActive: "never", flags: [], devices: [], payer: "web/app",
  };

  it("read-only roles see the no-money message in the adjust dialog", async () => {
    stub({ ...SIGNALS, "/users?": () => ({ users: [USER], total: 1 }) });
    renderWithStore(<Users />);
    await screen.findByText("Adjust coins…");
    act(() => getStore().setRole("ro"));
    fireEvent.click(screen.getByText("Adjust coins…"));
    await screen.findByText(/cannot make money adjustments/);
  });

  it("adjust server-refusal and ref-less success both render truthfully", async () => {
    let refuse = true;
    stub({
      ...SIGNALS,
      "/wallet/adjust": () => refuse
        ? { __status: 409, detail: "daily adjustment cap reached" }
        : { status: "applied", wallet: { total: 610 } },   // no ref field
      "/users?": () => ({ users: [USER], total: 1 }),
    });
    renderWithStore(<Users />);
    await screen.findByText("Adjust coins…");
    await online();
    fireEvent.click(screen.getByText("Adjust coins…"));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByText("Write ledger entry"));
    await lastToastIncludes("daily adjustment cap");
    refuse = false;
    fireEvent.click(within(dlg).getByText("Write ledger entry"));
    await lastToastIncludes("Ledger entry written");
  });

  it("refund and sign-out server errors surface; pending tabs skeleton", async () => {
    stub({
      ...SIGNALS,
      "/wallet/refund": () => ({ __status: 409, detail: "only purchases can be refunded" }),
      "/users/u1/signout-devices": () => ({ __status: 403, detail: "step-up required" }),
      "/users/u1/ledger": () => ({ user_id: "u1",
        wallet: { balance_bought: 600, balance_bonus: 0, total: 600 },
        transactions: [
          { id: "t1", type: "purchase", amount_bought: 600, amount_bonus: 0,
            reference_type: "iap", reference_id: "coins_starter_in",
            created_at: "2026-09-01T10:00:00+00:00" },
          { id: "t5", type: "unlock", amount_bought: -30, amount_bonus: 0,
            reference_type: "episode", reference_id: "solo-ref",
            created_at: "2026-09-01T10:04:00+00:00" }] }),
      "/users/u1/entitlements": () => ({ __hang: true }),
      "/users/u1/timeline": () => ({ __hang: true }),
      "/users/u1/devices": () => ({ devices: [
        { ua: "K/1", ip: "1.1.1.1", first_seen: "2026-09-01T09:00:00+00:00",
          last_seen: "2026-09-01T10:00:00+00:00" }] }),
      "/users?": () => ({ users: [USER], total: 1 }),
    });
    renderWithStore(<Users />);
    await screen.findByText("View ledger");
    await online();
    fireEvent.click(screen.getByText("View ledger"));
    const dlg = await screen.findByRole("dialog");
    // a colon-less unlock ref still links to its series (#025 alt branch)
    await waitFor(() => expect(screen.getByText("solo-ref").closest("a"))
      .toHaveAttribute("href", "/catalog/solo-ref"));
    fireEvent.click(screen.getByText("Refund"));
    await lastToastIncludes("only purchases can be refunded");
    // hanging fetches leave the skeleton in entitlements/timeline
    fireEvent.click(within(dlg).getByRole("tab", { name: "Entitlements" }));
    fireEvent.click(within(dlg).getByRole("tab", { name: "Timeline" }));
    fireEvent.click(within(dlg).getByRole("tab", { name: "Devices" }));
    fireEvent.click(screen.getByText("Sign out all devices"));
    await lastToastIncludes("step-up required");
  });
});

describe("Config — refusals and render alternates", () => {
  function policy() {
    return {
      dual_approval_threshold: 500, coin_rupee_rate: 0.15,
      pricing: { free_episode_count: 10, episode_coin_price: 30,
                 bundle_discount_pct: 25 },
      min_app_version: "1.0.0",
    };
  }

  it("guarded confirm mismatch does nothing; pack and version errors toast", async () => {
    const calls: string[] = [];
    stub({
      ...SIGNALS,
      "/config/policy": () => policy(),
      "/config/packs": (init) => init?.method === "PATCH"
        ? { __status: 400, detail: "bad pack values" }
        : [{ sku: "coins_starter_in", storefront: "IN", price_minor: 9900,
             currency: "INR", coins: 600, bonus: 0 },
           { sku: "coins_web_popular_in", storefront: "WEB", price_minor: 19900,
             currency: "INR", coins: 1300, bonus: 130 }],
      "/config/values/app.min_version": () =>
        ({ __status: 400, detail: "bad version value" }),
      "/experiments": () => ({ experiments: [
        { key: "old-exp", hypothesis: "", variants: [{ name: "a", pct: 100 }],
          status: "stopped" }] }),
      "/config/flags/store.web_enabled": () => { calls.push("flag"); return {}; },
    });
    renderWithStore(<Config />);
    await online();
    // stopped experiment renders the info sev + em-dash hypothesis
    await screen.findByText("old-exp");
    expect(screen.getByText("stopped")).toBeInTheDocument();
    // bonus column renders both branches
    expect(screen.getByText("+130")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // guarded flip with the WRONG confirm never calls the server
    const row = (await screen.findByText("store.web_enabled")).closest("li")!;
    fireEvent.click(within(row).getByRole("switch"));
    const guard = await screen.findByRole("dialog");
    fireEvent.change(within(guard).getByLabelText("Flag key"),
                     { target: { value: "wrong.key" } });
    fireEvent.click(within(guard).getByText("Flip it"));
    expect(calls).toEqual([]);
    fireEvent.keyDown(document, { key: "Escape" });
    // pack edit server-refusal
    fireEvent.click(screen.getAllByText("Edit…")[0]);
    const pack = await screen.findByRole("dialog");
    fireEvent.change(within(pack).getByLabelText("SKU"),
                     { target: { value: "coins_starter_in" } });
    fireEvent.click(within(pack).getByText("Save pack"));
    await lastToastIncludes("bad pack values");
    fireEvent.keyDown(document, { key: "Escape" });
    // min-version server-refusal
    fireEvent.click(screen.getByText("Save"));
    await lastToastIncludes("bad version value");
  });

  it("experiment variant parsing tolerates missing names and pcts", async () => {
    stub({
      ...SIGNALS,
      "/config/policy": () => policy(),
      "/config/packs": () => [],
      "/experiments/messy": () => ({ __status: 400, detail: "each variant needs name + pct>=0" }),
      "/experiments": () => ({ experiments: [] }),
    });
    renderWithStore(<Config />);
    await online();
    fireEvent.click(await screen.findByText("New experiment…"));
    const dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Experiment key"),
                     { target: { value: "messy" } });
    fireEvent.change(within(dlg).getByLabelText("Variants"),
                     { target: { value: "solo,:30" } });   // no pct · no name
    fireEvent.click(within(dlg).getByText("Start running"));
    await lastToastIncludes("each variant needs name");
  });
});

describe("Access, Grievances, Approvals, Audit — refusal branches", () => {
  it("grant/revoke server errors surface in People", async () => {
    stub({
      "/access/users/riya%40katha.dev": (init) => init?.method === "PUT"
        ? { __status: 409, detail: "you can't change your own access" }
        : { __status: 409, detail: "refusing to remove the last admin" },
      ...SIGNALS,
      "/auth/me": () => ({ mode: "oidc", authenticated: true, devIdp: true,
                           email: "ops@katha.dev", role: "admin" }),
      "/access/users": () => ({ users: [
        { email: "riya@katha.dev", role: "support", by: "x", at: "" }] }),
      "/access/matrix": () => null,
    });
    renderWithStore(<Access />);
    await screen.findByText("riya@katha.dev");
    await online();
    fireEvent.change(screen.getByLabelText("Email to provision"),
                     { target: { value: "riya@katha.dev" } });
    fireEvent.click(screen.getByText("Grant access"));
    await lastToastIncludes("Not granted: you can't change your own access");
    const row = screen.getByText("riya@katha.dev").closest("tr")!;
    fireEvent.click(within(row).getByText("Revoke"));
    await lastToastIncludes("Not revoked: refusing to remove the last admin");
  });

  it("grievance ack/resolve errors and breach chips render", async () => {
    const G = (over: object) => ({
      id: "G-1", user_id: "u", contact: "a@b", channel: "app", subject: "s",
      body: "", status: "new", assignee: "", created_at: "2026-08-01T00:00:00+00:00",
      ack_at: "", resolved_at: "", notes: [], age_hours: 700,
      ack_breach: false, resolve_breach: false, ...over,
    });
    stub({
      "/ack": () => ({ __status: 409, detail: "already acknowledged" }),
      "/resolve": () => ({ __status: 400, detail: "resolution note required" }),
      ...SIGNALS,
      "/grievances": () => ({ grievances: [
        G({}), G({ id: "G-2", status: "ack", resolve_breach: true }),
        G({ id: "G-3", status: "resolved",
            resolved_at: "2026-08-20T00:00:00+00:00" })] }),
    });
    renderWithStore(<Grievances />);
    await screen.findByText("G-1");
    await online();
    expect(screen.getByText("15d BREACH")).toBeInTheDocument();
    expect(screen.getByText(/· resolved/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Acknowledge")[0]);
    await lastToastIncludes("already acknowledged");
    fireEvent.click(screen.getAllByText("Resolve…")[0]);
    const dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText(/Resolution note/),
                     { target: { value: "done" } });
    fireEvent.click(within(dlg).getByText("Mark resolved"));
    await lastToastIncludes("resolution note required");
  });

  it("approvals: self-approve guard, decided rows, age chips", async () => {
    stub({
      "/approvals/ap2/approve": () => ({ status: "applied" }),
      ...SIGNALS,
      "/approvals?status=pending": () => [
        { id: "ap1", kind: "Coin adjustment", status: "pending",
          detail: "+900 · u1", requestedBy: "riya", when: "2026-08-30T00:00:00+00:00",
          needs: "Finance", amount: 900, userId: "u1", balanceBefore: 10,
          balanceAfter: null, requesterToday: 1, approvedBy: "" },
        { id: "ap2", kind: "Coin adjustment", status: "pending",
          detail: "+600 · u2", requestedBy: "sam",
          when: new Date(Date.now() - 6 * 3600e3).toISOString(),
          needs: "Finance", amount: 600, userId: "u2", balanceBefore: 5,
          balanceAfter: 605, requesterToday: 2, approvedBy: "" }],
      "/approvals?status=all": () => [
        { id: "ap0", kind: "Coin adjustment", status: "approved",
          detail: "+700 · u0", requestedBy: "sam", when: "2026-08-29T00:00:00+00:00",
          needs: "Finance", amount: 700, userId: "u0", balanceBefore: null,
          balanceAfter: null, requesterToday: 0, approvedBy: "farah" }],
    });
    renderWithStore(<Approvals />);
    await screen.findByText(/\+900 · u1/);
    await online();
    // the requester's own request has a dead Approve with the reason as title
    const mine = screen.getByText(/\+900 · u1/).closest("li")!;
    const myBtn = within(mine).getByText("Approve");
    expect(myBtn).toBeDisabled();
    expect(myBtn).toHaveAttribute("title", "Requester cannot self-approve");
    // someone else's request approves fine
    const theirs = screen.getByText(/\+600 · u2/).closest("li")!;
    fireEvent.click(within(theirs).getByText("Approve"));
    await waitFor(() => expect(getStore().audit.some((e) =>
      e.action === "approval.approve")).toBe(true));
    // SLA chips: >24h breach + warn-band hours
    expect(screen.getByText("SLA breach")).toBeInTheDocument();
    expect(screen.getByText(/6h old/)).toBeInTheDocument();
    // decided history renders the ok sev
    fireEvent.click(screen.getByRole("tab", { name: /history/i }));
    await screen.findByText(/\+700 · u0/);
  });

  it("audit: annotate refusals and csv-escapes null ip", async () => {
    stub({
      "/audit/9/note": () => ({ __status: 400, detail: "note must be 1-300 chars" }),
      ...SIGNALS,
      "/audit": () => ({ chain_ok: true, total: 1, rows: [
        { id: 9, ts: "2026-09-01T10:00:00+00:00", actor: "riya",
          action: "x.y", entity: "e", change: "c" }] }),
    });
    renderWithStore(<Audit />);
    await screen.findByText("x.y");
    await online();
    fireEvent.click(screen.getByTitle(/Annotate/));
    const dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Annotation"),
                     { target: { value: "z" } });
    fireEvent.click(within(dlg).getByText("Save note"));
    await lastToastIncludes("note must be 1-300 chars");
  });
});

describe("Overview, Catalog, App-level ternaries", () => {
  it("morning greeting, down-deltas on server kpis, zero-purchase split", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-01T09:00:00"));
    stub({
      ...SIGNALS,
      "/overview": () => ({ kpis: [
        { label: "Registered users", value: "95", delta: "-3%", deltaDir: "down" },
        { label: "Mystery metric", value: "7", delta: "+1%" }], pipeline: [],
        attention: [] }),
      "/analytics": () => ({
        windows: Object.fromEntries(["today", "7d", "30d"].map((w) => [w, {
          current: { coins_purchased: 0, revenue_rupees: 0, coins_iap: 0,
                     coins_web: 0, unlocks: 0, dau_peak: 0, new_users: 0,
                     watch_minutes: 0, coins_refunded: 0, refund_ratio_pct: 0 },
          previous: { coins_purchased: 0, revenue_rupees: 0, coins_iap: 0,
                      coins_web: 0, unlocks: 0, dau_peak: 0, new_users: 0,
                      watch_minutes: 0, coins_refunded: 0, refund_ratio_pct: 0 },
        }])),
        funnel: { "1d": { paywall_view: 0, purchase: 0, unlock: 0 },
                  "7d": { paywall_view: 0, purchase: 0, unlock: 0 },
                  "30d": { paywall_view: 0, purchase: 0, unlock: 0 } },
        days: [], spark: { coins_purchased: [], unlocks: [], dau: [],
                           new_users: [], watch_minutes: [], paywall_views: [] },
        outstanding_trend: [], outstanding_rupees: 0,
        breakage_dormant_coins: 0, coin_rupee_rate: 0.15,
        generated_at: "t",
      }),
    });
    renderWithStore(<Overview />);
    await screen.findByText(/Good morning/);
    expect(screen.getByText("-3%")).toBeInTheDocument();     // down-delta class
    expect(screen.getByText("Mystery metric")).toBeInTheDocument(); // unlinked kpi
    expect(screen.getByText(/App Store 0%/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("ack failing silently keeps the rail intact", async () => {
    stub({
      ...SIGNALS,
      "/attention": () => ({ items: [
        { id: "a1", severity: "warn", title: "One thing", detail: "d",
          to: "/approvals" }] }),
      "/overview": () => ({ kpis: [], pipeline: [], attention: [] }),
      "/analytics": () => null,
    });
    renderWithStore(<Overview />);
    await screen.findByText("One thing");
    await online();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    fireEvent.click(screen.getByText("Ack"));
    expect(screen.getByText("One thing")).toBeInTheDocument();
  });

  it("catalog filters walk language, status-normalization and search misses", async () => {
    renderWithStore(<Catalog />);   // offline → mock rows
    await screen.findByLabelText("Search catalog");
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "Tamil" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "archived" } });
    fireEvent.change(screen.getByLabelText("Search catalog"),
                     { target: { value: "zz-no-match" } });
    await screen.findByText("No series match");
  });

  it("sidebar shows the approvals badge and email-only identities", async () => {
    stub({
      ...SIGNALS,
      "/auth/me": () => ({ mode: "oidc", authenticated: true, devIdp: true,
                           email: "noname@katha.dev", role: "admin" }),
      "/approvals?status=pending": () => [],
    });
    renderWithStore(<Sidebar />);
    await screen.findByText("noname@katha.dev");   // name-less fallback
    act(() => getStore().addApproval({
      id: "b1", kind: "Coin adjustment", status: "pending", detail: "d",
      requestedBy: "x", when: "t", needs: "Finance", amount: 1, userId: "u",
    } as never));
    await screen.findByText("1");                  // the count badge
  });

  it("store.setFlagPct: unknown flag and server refusal", async () => {
    stub({ ...SIGNALS,
           "/config/flags/rewards.checkin_enabled": () =>
             ({ __status: 428, detail: "guarded flag" }) });
    renderWithStore(<Catalog />);
    const res = await getStore().setFlagPct("no.such.flag", 10);
    expect(res).toEqual({ error: "unknown flag" });
    await waitFor(async () => {
      const r = await getStore().setFlagPct("rewards.checkin_enabled", 10);
      expect("error" in r && r.error).toBe("guarded flag");
    });
    await lastToastIncludes("Rollout not changed");
  });

  it("client: segment params online, segment filters offline, detail-less errors", async () => {
    const seen: string[] = [];
    stub({ "/users?": (init) => { return { users: [], total: 0 }; },
           ...SIGNALS }, true);
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      seen.push(String(url));
      return Promise.resolve({ ok: true, json: async () => ({ users: [], total: 0 }) });
    }));
    await api.listUsers({ segment: "payers", offset: 50 });
    expect(seen[0]).toContain("segment=payers");
    expect(seen[0]).toContain("offset=50");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const guests = await api.listUsers({ segment: "guests" });
    expect(guests.users.every((u) => u.payer === "—")).toBe(true);
    const payers = await api.listUsers({ segment: "payers" });
    expect(payers.users.every((u) => u.payer !== "—")).toBe(true);
    // an error body without detail falls back to the HTTP status
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 502, json: async () => ({}) }));
    const res = await send("/x", "POST");
    expect(res).toMatchObject({ error: "HTTP 502" });
  });

  it("Spark tolerates flat and single-point series", () => {
    const ctx = { scale: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(),
                  moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
                  closePath: vi.fn(), fill: vi.fn(), arc: vi.fn() };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    render(<><Spark points={[4]} /><Spark points={[5, 5]} /></>);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);   // single point never draws
    spy.mockRestore();
  });
});

describe("the last branch cluster", () => {
  it("palette: arrow boundaries and the no-matches row", async () => {
    const { default: App } = await import("../src/App");
    stub({ ...SIGNALS, "/access/matrix": () => null });
    renderWithStore(<App />, { route: "/access" });
    await screen.findByText("Permission matrix");
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const input = await screen.findByPlaceholderText(/Jump to a user/);
    fireEvent.keyDown(input, { key: "ArrowUp" });               // clamp at 0
    for (let i = 0; i < 12; i++) {
      fireEvent.keyDown(input, { key: "ArrowDown" });           // clamp at end
    }
    fireEvent.change(input, { target: { value: "zzz-nothing-matches" } });
    await screen.findByText("No matches");
    fireEvent.keyDown(input, { key: "Escape" });
  });

  it("topbar shows degraded and down states", async () => {
    const { default: App } = await import("../src/App");
    let status = "degraded";
    stub({
      "/health/full": () => ({ status, checks: { db: status }, at: "" }),
      "/auth/me": () => ({ mode: "headers", authenticated: true }),
      "/attention": () => ({ items: [] }),
      "/access/matrix": () => null,
    });
    renderWithStore(<App />, { route: "/access" });
    await online();
    await screen.findByText("Degraded");
    status = "down";
    act(() => getStore().refreshSignals());
    await screen.findByText("Service down");
  });

  it("login: reason-less error cookie and the online path", async () => {
    const { Login } = await import("../src/views/Login");
    document.cookie = "katha_admin_auth_note=" + encodeURIComponent("error:");
    stub({ ...SIGNALS });
    renderWithStore(<Login />);
    expect(screen.getByRole("alert").textContent).toContain("unknown error");
    await online();   // the offline note branch flips off
    await waitFor(() =>
      expect(screen.queryByText(/server is unreachable/)).toBeNull());
  });

  it("grievances: offline resolve refuses honestly", async () => {
    stub({
      ...SIGNALS,
      "/grievances": () => ({ grievances: [{
        id: "G-9", user_id: "u", contact: "a@b", channel: "app", subject: "s",
        body: "", status: "ack", assignee: "sam",
        created_at: "2026-09-01T00:00:00+00:00", ack_at: "t", resolved_at: "",
        notes: [], age_hours: 1, ack_breach: false, resolve_breach: false }] }),
    });
    renderWithStore(<Grievances />);
    await screen.findByText("G-9");
    await online();
    fireEvent.click(screen.getByText("Resolve…"));
    const dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText(/Resolution note/),
                     { target: { value: "done" } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    fireEvent.click(within(dlg).getByText("Mark resolved"));
    await lastToastIncludes("Offline — not resolved");
  });

  it("afternoon greeting and unknown access roles render", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-01T15:00:00"));
    stub({
      ...SIGNALS,
      "/overview": () => ({ kpis: [], pipeline: [], attention: [] }),
      "/analytics": () => null,
    });
    renderWithStore(<Overview />);
    await screen.findByText(/Good afternoon/);
    vi.useRealTimers();

    stub({
      ...SIGNALS,
      "/auth/me": () => ({ mode: "oidc", authenticated: true, devIdp: true,
                           email: "ops@katha.dev", role: "admin" }),
      "/access/users": () => ({ users: [
        { email: "odd@katha.dev", role: "czar" }] }),   // unknown role, no `by`
      "/access/matrix": () => null,
    });
    renderWithStore(<Access />);
    await screen.findByText("odd@katha.dev");
    expect(screen.getByText("czar")).toBeInTheDocument();
  });
});

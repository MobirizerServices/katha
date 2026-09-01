import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { Overview } from "../src/views/Overview";
import { Users } from "../src/views/Users";
import { Catalog } from "../src/views/Catalog";
import { CatalogDetail } from "../src/views/CatalogDetail";
import { Config } from "../src/views/Config";
import { api } from "../src/api/client";
import { renderWithStore, getStore } from "./helpers";

const W = (over: Partial<Record<string, number>> = {}) => ({
  coins_purchased: 1500, revenue_rupees: 225, coins_iap: 1000, coins_web: 500,
  unlocks: 12, dau_peak: 40, new_users: 9, watch_minutes: 300,
  coins_refunded: 100, refund_ratio_pct: 6.67, ...over,
});

const ANALYTICS = {
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
  spark: Object.fromEntries(["coins_purchased", "unlocks", "dau", "new_users",
                             "watch_minutes", "paywall_views"]
    .map((k) => [k, Array.from({ length: 30 }, (_, i) => i)])),
  outstanding_trend: Array.from({ length: 30 }, (_, i) => 1000 + i),
  outstanding_rupees: 154,
  breakage_dormant_coins: 77,
  coin_rupee_rate: 0.15,
  generated_at: "2026-09-01T18:00:00+00:00",
};

type Stub = Record<string, (init?: RequestInit) => unknown>;

function stub(routes: Stub) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation(
    (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      for (const [needle, respond] of Object.entries(routes)) {
        if (String(url).includes(needle)) {
          return Promise.resolve({ ok: true, json: async () => respond(init) });
        }
      }
      return Promise.reject(new Error("offline"));
    }));
  return calls;
}

const SIGNALS: Stub = {
  "/health/full": () => ({ status: "ok", checks: {}, at: "" }),
  "/auth/me": () => ({ mode: "headers", authenticated: true }),
};

async function online() {
  act(() => getStore().refreshSignals());
  await waitFor(() => expect(getStore().online).toBe(true));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Overview — the business board (#009-#015)", () => {
  const OVERVIEW = {
    kpis: [{ label: "Registered users", value: "95" }],
    pipeline: [],
    attention: [],
  };

  function boot(extra: Stub = {}) {
    return stub({
      ...SIGNALS,
      "/attention": () => ({ items: [] }),
      "/overview": () => OVERVIEW,
      "/analytics": () => ANALYTICS,
      ...extra,
    });
  }

  it("renders windowed metrics with deltas, funnel, split and liability", async () => {
    boot();
    renderWithStore(<Overview />);
    await screen.findByText("The business");
    // default 7d window: revenue 1000 vs 500 → ▲ 100%
    expect(screen.getByText("₹1,000")).toBeInTheDocument();
    expect(screen.getByText(/▲ 100%/)).toBeInTheDocument();
    // funnel for 7d with drop-offs
    expect(screen.getByText("Saw the paywall")).toBeInTheDocument();
    expect(screen.getByText(/60% drop/)).toBeInTheDocument();
    // revenue split names both channels
    expect(screen.getByText(/App Store 67%/)).toBeInTheDocument();
    // refunds over the 2% threshold render as danger
    expect(screen.getByText("6.67%")).toBeInTheDocument();
    // liability
    expect(screen.getByText("1,029 coins")).toBeInTheDocument();
    expect(screen.getByText(/77 coins dormant/)).toBeInTheDocument();
  });

  it("window switcher changes the period", async () => {
    boot();
    renderWithStore(<Overview />);
    await screen.findByText("The business");
    fireEvent.click(screen.getByRole("tab", { name: "Today" }));
    expect(screen.getByText("₹225")).toBeInTheDocument();
    expect(screen.getAllByText(/▲ 50%/).length).toBeGreaterThan(0); // 225 vs 150
    fireEvent.click(screen.getByRole("tab", { name: "30d" }));
    expect(screen.getAllByText(/±0%/).length).toBeGreaterThan(0);
  });

  it("attention items can be acknowledged and show their owner (#016)", async () => {
    let acked = false;
    // NOTE: insertion order matters — the ack POST must match before the
    // plain /attention prefix.
    stub({
      "/attention/G-1/ack": () => { acked = true; return { id: "G-1" }; },
      ...SIGNALS,
      "/overview": () => OVERVIEW,
      "/analytics": () => ANALYTICS,
      "/attention": () => ({ items: [
        { id: "G-1", severity: "danger", title: "Grievance G-1 breaches 24 h",
          detail: "stuck payment", to: "/grievances",
          ...(acked ? { ack: { by: "riya", at: "t" } } : {}) }] }),
    });
    renderWithStore(<Overview />);
    await screen.findByText(/Grievance G-1/);
    await online();
    fireEvent.click(screen.getByText("Ack"));
    await screen.findByText(/✓ riya/);
  });
});

describe("Users — devices & sign-out everywhere (#021/#022)", () => {
  const USER = {
    id: "u1", phone: "+91", name: "—", languages: "hi",
    wallet: { bought: 600, bonus: 0, unlocked: 2, ltv: "₹90" },
    lastActive: "2026-09-01T10:00:00+00:00",
    flags: ["repeat refunds"], devices: [], payer: "web/app",
  };

  it("shows risk flags in the directory and devices in the drawer", async () => {
    stub({
      ...SIGNALS,
      "/attention": () => ({ items: [] }),
      "/users/u1/devices": () => ({ devices: [
        { ua: "KathaApp/1.0 (iPhone 16)", ip: "192.168.1.4",
          first_seen: "2026-09-01T09:00:00+00:00",
          last_seen: "2026-09-01T10:00:00+00:00" }] }),
      "/users/u1/signout-devices": () => ({ user_id: "u1", token_version: 1 }),
      "/users/u1/ledger": () => ({ user_id: "u1",
        wallet: { balance_bought: 600, balance_bonus: 0, total: 600 },
        transactions: [] }),
      "/users/u1/entitlements": () => ({ entitlements: [] }),
      "/users/u1/timeline": () => ({ events: [] }),
      "/users?": () => ({ users: [USER], total: 1 }),
    });
    renderWithStore(<Users />);
    await screen.findByText("repeat refunds");
    await online();
    fireEvent.click(screen.getByText("View ledger"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Devices" }));
    await screen.findByText(/KathaApp\/1.0/);
    expect(screen.getByText("192.168.1.4")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Sign out all devices"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text.includes("All devices signed out"))).toBe(true));
  });
});

describe("Catalog — create series (#043)", () => {
  it("drafts a series and reloads the list", async () => {
    const calls = stub({
      ...SIGNALS,
      "/attention": () => ({ items: [] }),
      "/catalog/series": (init) =>
        init?.method === "POST"
          ? { slug: "naya-safar", status: "draft" }
          : [],
    });
    renderWithStore(<Catalog />);
    await online();
    fireEvent.click(await screen.findByText("New series…"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Slug"),
                     { target: { value: "naya-safar" } });
    fireEvent.change(within(dialog).getByLabelText("Title"),
                     { target: { value: "Naya Safar" } });
    fireEvent.change(within(dialog).getByLabelText("Episode count"),
                     { target: { value: "12" } });
    fireEvent.change(within(dialog).getByLabelText("Language of series"),
                     { target: { value: "ta" } });
    fireEvent.change(within(dialog).getByLabelText("Coin price"),
                     { target: { value: "25" } });
    fireEvent.change(within(dialog).getByLabelText("Free episode count"),
                     { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText("Synopsis"),
                     { target: { value: "A new road." } });
    fireEvent.click(within(dialog).getByText("Create draft"));
    await waitFor(() => {
      const post = calls.find((c) => c.init?.method === "POST");
      expect(JSON.parse(String(post?.init?.body))).toMatchObject({
        slug: "naya-safar", title: "Naya Safar", episode_count: 12,
        language: "ta", coin_price: 25, free_episodes: 3,
      });
    });
    expect(getStore().toasts.some((t) => t.text.includes("drafted"))).toBe(true);
  });
});

describe("CatalogDetail — pricing, rights, retitle (#034/#039/#040)", () => {
  const DETAIL = {
    slug: "kaanch-ka-mahal", title: "Kaanch Ka Mahal", synopsis: "s",
    genres: ["Drama"], language: "Hindi", episodeCount: 3, freeEpisodes: 1,
    coinPrice: 30, bundleDiscountPct: 25, status: "live", rating: "U/A 13+",
    ratingHistory: {}, updatedAt: "", coverUrl: "http://x/c.jpg",
    pricingOverridden: false,
    rights: { owner: "Katha Originals", license_until: "" },
    media: { covers_ok: true, episodes_with_media: 3, episodes_missing: 0 },
    episodes: [
      { number: 1, title: "One", isFree: true, hasMedia: true },
      { number: 2, title: "Two", isFree: false, hasMedia: false },
    ],
    previewWeb: "http://x/w",
  };

  function boot() {
    const calls = stub({
      ...SIGNALS,
      "/attention": () => ({ items: [] }),
      "/pricing": () => ({ slug: DETAIL.slug }),
      "/rights": () => ({ slug: DETAIL.slug }),
      "/episodes/2": () => ({ slug: DETAIL.slug, number: 2, title: "Better" }),
      "/catalog/series/kaanch-ka-mahal": () => DETAIL,
    });
    renderWithStore(
      <Routes><Route path="/catalog/:slug" element={<CatalogDetail />} /></Routes>,
      { route: "/catalog/kaanch-ka-mahal" });
    return calls;
  }

  it("repricing needs the typed slug and posts the confirm", async () => {
    const calls = boot();
    await screen.findByText("Kaanch Ka Mahal");
    await online();
    fireEvent.click(screen.getByText("Reprice…"));
    const dialog = await screen.findByRole("dialog");
    const go = within(dialog).getByText("Change pricing");
    expect(go).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Coins per episode"),
                     { target: { value: "40" } });
    fireEvent.change(within(dialog).getByLabelText("Free episodes"),
                     { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Confirm slug"),
                     { target: { value: "kaanch-ka-mahal" } });
    fireEvent.click(go);
    await waitFor(() => {
      const patch = calls.find((c) => c.url.includes("/pricing"));
      expect(JSON.parse(String(patch?.init?.body))).toMatchObject({
        coin_price: 40, free_episodes: 2, confirm: "kaanch-ka-mahal",
      });
    });
  });

  it("edits rights and renames an episode; media state is visible", async () => {
    const calls = boot();
    await screen.findByText("Kaanch Ka Mahal");
    await online();
    expect(screen.getByText("no media")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Edit…"));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Owner"),
                     { target: { value: "Studio X" } });
    fireEvent.change(within(dialog).getByLabelText("Licensed until"),
                     { target: { value: "2026-12-31" } });
    fireEvent.click(within(dialog).getByText("Save rights"));
    await waitFor(() => {
      const patch = calls.find((c) => c.url.includes("/rights"));
      expect(JSON.parse(String(patch?.init?.body))).toMatchObject({
        owner: "Studio X", license_until: "2026-12-31",
      });
    });
    fireEvent.click(screen.getAllByText("Rename…")[1]);
    dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Episode title"),
                     { target: { value: "Better" } });
    fireEvent.click(within(dialog).getByText("Rename"));
    await waitFor(() => {
      const patch = calls.find((c) => c.url.includes("/episodes/2"));
      expect(JSON.parse(String(patch?.init?.body))).toEqual({ title: "Better" });
    });
  });
});

describe("Config — rollout ramps & experiments (#056/#061)", () => {
  function boot(extra: Stub = {}) {
    return stub({
      ...SIGNALS,
      "/attention": () => ({ items: [] }),
      "/config/policy": () => ({
        dual_approval_threshold: 500, coin_rupee_rate: 0.15,
        pricing: { free_episode_count: 10, episode_coin_price: 30,
                   bundle_discount_pct: 25 },
        min_app_version: "1.0.0",
      }),
      "/config/packs": () => [],
      "/experiments/free-count": () => ({ key: "free-count", status: "running" }),
      "/experiments": () => ({ experiments: [] }),
      ...extra,
    });
  }

  it("sets a percentage rollout through the ramp modal", async () => {
    const calls = boot({
      "/config/flags/rewards.referral_enabled": () =>
        ({ key: "rewards.referral_enabled", enabled: false, pct: 25 }),
    });
    renderWithStore(<Config />);
    await online();
    const row = (await screen.findByText("rewards.referral_enabled")).closest("li")!;
    fireEvent.click(within(row).getByText("Ramp…"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Rollout percent"),
                     { target: { value: "25" } });
    fireEvent.click(within(dialog).getByText("Set rollout"));
    await waitFor(() => {
      const patch = calls.find((c) =>
        c.url.includes("/config/flags/rewards.referral_enabled"));
      expect(JSON.parse(String(patch?.init?.body))).toMatchObject({ pct: 25 });
    });
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text.includes("25% of users"))).toBe(true));
    expect(within(row).getByText("25%")).toBeInTheDocument();
  });

  it("registers and stops an experiment", async () => {
    let running = false;
    const calls = boot({
      "/experiments/free-count": () => { running = !running;
        return { key: "free-count", status: running ? "running" : "stopped" }; },
      "/experiments": () => ({ experiments: running ? [
        { key: "free-count", hypothesis: "8 beats 10",
          variants: [{ name: "control", pct: 50 }, { name: "eight", pct: 50 }],
          status: "running" }] : [] }),
    });
    renderWithStore(<Config />);
    await online();
    fireEvent.click(await screen.findByText("New experiment…"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Experiment key"),
                     { target: { value: "free-count" } });
    fireEvent.change(within(dialog).getByLabelText("Hypothesis"),
                     { target: { value: "8 beats 10" } });
    fireEvent.change(within(dialog).getByLabelText("Variants"),
                     { target: { value: "control:50,eight:50" } });
    fireEvent.click(within(dialog).getByText("Start running"));
    await screen.findByText("8 beats 10");
    const put = calls.find((c) => c.init?.method === "PUT");
    expect(JSON.parse(String(put?.init?.body))).toMatchObject({
      status: "running",
      variants: [{ name: "control", pct: 50 }, { name: "eight", pct: 50 }],
    });
    fireEvent.click(screen.getByText("Stop"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text.includes("stopped"))).toBe(true));
  });
});

describe("client cache (#103)", () => {
  it("serves hot lists from the 30s cache without refetching", async () => {
    const calls = stub({ "/catalog/series": () => [] });
    await api.listSeries();
    await api.listSeries();
    expect(calls.filter((c) => c.url.includes("/catalog/series")).length).toBe(1);
  });
});

describe("coverage sweeps — the unhappy directions", () => {
  it("Spark draws when a real 2d context exists", () => {
    const ctx = {
      scale: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), stroke: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
      arc: vi.fn(), strokeStyle: "", fillStyle: "", lineWidth: 0,
    };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    renderWithStore(<OverviewSparkProbe />);
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("down-deltas, healthy refunds, new metrics and an empty funnel", async () => {
    const shrunk = {
      ...ANALYTICS,
      windows: {
        today: { current: W({ revenue_rupees: 50, coins_purchased: 50,
                              refund_ratio_pct: 1, coins_iap: 0,
                              coins_web: 0, unlocks: 0 }),
                 previous: W({ revenue_rupees: 100, unlocks: 0 }) },
        "7d": { current: W({ new_users: 3, refund_ratio_pct: 0 }),
                previous: W({ new_users: 0 }) },
        "30d": { current: W(), previous: W() },
      },
      funnel: { "1d": { paywall_view: 0, purchase: 0, unlock: 0 },
                "7d": { paywall_view: 0, purchase: 0, unlock: 0 },
                "30d": { paywall_view: 0, purchase: 0, unlock: 0 } },
      outstanding_trend: [],
      outstanding_rupees: 0,
    };
    stub({
      ...SIGNALS,
      "/attention": () => ({ items: [] }),
      "/overview": () => ({ kpis: [], pipeline: [], attention: [] }),
      "/analytics": () => shrunk,
    });
    renderWithStore(<Overview />);
    await screen.findByText("The business");
    // 7d: previous new_users 0, current 3 → "new" chip
    expect(screen.getAllByText("new").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Today" }));
    expect(screen.getAllByText(/▼ 50%/).length).toBeGreaterThan(0);
    // refunds at 1% render as ok, an all-zero funnel renders without drops
    expect(screen.getByText("1%")).toBeInTheDocument();
    expect(screen.getByText("Saw the paywall")).toBeInTheDocument();
    expect(screen.getByText("0 coins")).toBeInTheDocument();
  });

  it("devices tab: empty state, and offline sign-out refuses honestly", async () => {
    stub({
      ...SIGNALS,
      "/attention": () => ({ items: [] }),
      "/users/u1/devices": () => ({ devices: [] }),
      "/users/u1/ledger": () => ({ user_id: "u1",
        wallet: { balance_bought: 0, balance_bonus: 0, total: 0 },
        transactions: [] }),
      "/users/u1/entitlements": () => ({ entitlements: [] }),
      "/users/u1/timeline": () => ({ events: [] }),
      "/users?": () => ({ users: [{
        id: "u1", phone: "+91", name: "—", languages: "hi",
        wallet: { bought: 0, bonus: 0, unlocked: 0, ltv: "₹0" },
        lastActive: "never", flags: [], devices: [], payer: "—" }], total: 1 }),
    });
    renderWithStore(<Users />);
    await online();
    fireEvent.click(await screen.findByText("View ledger"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Devices" }));
    await screen.findByText(/No devices observed yet/);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    fireEvent.click(screen.getByText("Sign out all devices"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text.includes("Offline — nothing signed out"))).toBe(true));
  });

  it("guarded flags ramp with the typed confirm; offline experiments refuse", async () => {
    const calls = stub({
      ...SIGNALS,
      "/attention": () => ({ items: [] }),
      "/config/policy": () => ({
        dual_approval_threshold: 500, coin_rupee_rate: 0.15,
        pricing: { free_episode_count: 10, episode_coin_price: 30,
                   bundle_discount_pct: 25 },
        min_app_version: "1.0.0" }),
      "/config/packs": () => [],
      "/experiments": () => ({ experiments: [] }),
      "/config/flags/store.web_enabled": () =>
        ({ key: "store.web_enabled", enabled: true, pct: 50 }),
    });
    renderWithStore(<Config />);
    await online();
    const row = (await screen.findByText("store.web_enabled")).closest("li")!;
    fireEvent.click(within(row).getByText("Ramp…"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Rollout percent"),
                     { target: { value: "50" } });
    fireEvent.click(within(dialog).getByText("Set rollout"));
    await waitFor(() => {
      const patch = calls.find((c) => c.url.includes("store.web_enabled"));
      expect(JSON.parse(String(patch?.init?.body)))
        .toMatchObject({ pct: 50, confirm: "store.web_enabled" });
    });
    // offline: creating an experiment reports the truth
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    fireEvent.click(screen.getByText("New experiment…"));
    const dlg2 = await screen.findByRole("dialog");
    fireEvent.change(within(dlg2).getByLabelText("Experiment key"),
                     { target: { value: "x-exp" } });
    fireEvent.click(within(dlg2).getByText("Start running"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text.includes("Offline — experiment unchanged"))).toBe(true));
  });
});

function OverviewSparkProbe() {
  return <SparkProbeInner />;
}

import { Spark } from "../src/ui";
function SparkProbeInner() {
  return <Spark points={[1, 5, 2, 8]} />;
}

describe("modal closers", () => {
  it("CatalogDetail's new modals cancel and escape cleanly", async () => {
    stub({
      ...SIGNALS,
      "/attention": () => ({ items: [] }),
      "/catalog/series/kaanch-ka-mahal": () => ({
        slug: "kaanch-ka-mahal", title: "Kaanch Ka Mahal", synopsis: "s",
        genres: ["Drama"], language: "Hindi", episodeCount: 2, freeEpisodes: 1,
        coinPrice: 30, bundleDiscountPct: 25, status: "live", rating: "U/A 13+",
        ratingHistory: {}, updatedAt: "", coverUrl: "x", pricingOverridden: true,
        rights: { owner: "Studio X", license_until: "2027-01-01" },
        media: { covers_ok: true, episodes_with_media: 2, episodes_missing: 0 },
        episodes: [{ number: 1, title: "One", isFree: true, hasMedia: true }],
        previewWeb: "http://x/w",
      }),
    });
    renderWithStore(
      <Routes><Route path="/catalog/:slug" element={<CatalogDetail />} /></Routes>,
      { route: "/catalog/kaanch-ka-mahal" });
    await screen.findByText("Kaanch Ka Mahal");
    await online();
    expect(screen.getByText("overridden")).toBeInTheDocument();
    for (const [open, cancel] of [["Reprice…", "Cancel"], ["Edit…", "Cancel"],
                                  ["Rename…", "Cancel"]] as const) {
      fireEvent.click(screen.getAllByText(open)[0]);
      const dlg = await screen.findByRole("dialog");
      fireEvent.click(within(dlg).getByText(cancel));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      fireEvent.click(screen.getAllByText(open)[0]);
      await screen.findByRole("dialog");
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
  });

  it("Config's ramp + experiment modals cancel; Access admin-grant cancels", async () => {
    stub({
      ...SIGNALS,
      "/attention": () => ({ items: [] }),
      "/config/policy": () => ({
        dual_approval_threshold: 500, coin_rupee_rate: 0.15,
        pricing: { free_episode_count: 10, episode_coin_price: 30,
                   bundle_discount_pct: 25 },
        min_app_version: "1.0.0" }),
      "/config/packs": () => [],
      "/experiments": () => ({ experiments: [] }),
    });
    renderWithStore(<Config />);
    await online();
    const row = (await screen.findByText("rewards.checkin_enabled")).closest("li")!;
    fireEvent.click(within(row).getByText("Ramp…"));
    let dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByText("New experiment…"));
    dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Access People: the admin-grant confirm cancels", async () => {
    const { Access } = await import("../src/views/Access");
    stub({
      ...SIGNALS,
      "/attention": () => ({ items: [] }),
      "/auth/me": () => ({ mode: "oidc", authenticated: true, devIdp: true,
                           email: "ops@katha.dev", role: "admin" }),
      "/access/users": () => ({ users: [
        { email: "ops@katha.dev", role: "admin", by: "bootstrap", at: "t" }] }),
      "/access/matrix": () => null,
    });
    renderWithStore(<Access />);
    await screen.findAllByText("ops@katha.dev");
    await online();
    fireEvent.change(screen.getByLabelText("Email to provision"),
                     { target: { value: "lead@katha.dev" } });
    fireEvent.change(screen.getByLabelText("Role to grant"),
                     { target: { value: "admin" } });
    fireEvent.click(screen.getByText("Grant access"));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("i18n scaffold (#100)", () => {
  it("t() falls through to English and swaps catalogs by locale", async () => {
    const { t, setLocale, getLocale } = await import("../src/i18n");
    expect(t("All systems normal")).toBe("All systems normal");
    setLocale("hi");
    expect(getLocale()).toBe("hi");
    expect(t("All systems normal")).toBe("सभी सिस्टम सामान्य");
    expect(t("untranslated key")).toBe("untranslated key");
    setLocale("en");
  });
});

describe("ledger deep-links (#025) & audit annotations (#070)", () => {
  it("pack, episode and bundle references link to their homes", async () => {
    stub({
      ...SIGNALS,
      "/attention": () => ({ items: [] }),
      "/users/u1/devices": () => ({ devices: [] }),
      "/users/u1/ledger": () => ({ user_id: "u1",
        wallet: { balance_bought: 600, balance_bonus: 0, total: 600 },
        transactions: [
          { id: "t1", type: "purchase", amount_bought: 600, amount_bonus: 0,
            reference_type: "iap", reference_id: "coins_starter_in",
            created_at: "2026-09-01T10:00:00+00:00" },
          { id: "t2", type: "unlock", amount_bought: -30, amount_bonus: 0,
            reference_type: "episode", reference_id: "kaanch-ka-mahal:e11",
            created_at: "2026-09-01T10:01:00+00:00" },
          { id: "t3", type: "unlock", amount_bought: -500, amount_bonus: 0,
            reference_type: "bundle", reference_id: "ceo-sahab",
            created_at: "2026-09-01T10:02:00+00:00" },
          { id: "t4", type: "admin_adjust", amount_bought: 50, amount_bonus: 0,
            reference_type: "admin_adjust:goodwill", reference_id: "adjust:x1",
            created_at: "2026-09-01T10:03:00+00:00" }] }),
      "/users/u1/entitlements": () => ({ entitlements: [] }),
      "/users/u1/timeline": () => ({ events: [] }),
      "/users?": () => ({ users: [{
        id: "u1", phone: "+91", name: "—", languages: "hi",
        wallet: { bought: 120, bonus: 0, unlocked: 1, ltv: "₹18" },
        lastActive: "never", flags: [], devices: [], payer: "web/app" }],
        total: 1 }),
    });
    renderWithStore(<Users />);
    await online();
    fireEvent.click(await screen.findByText("View ledger"));
    await screen.findByRole("dialog");
    const pack = await screen.findByText("coins_starter_in");
    expect(pack.closest("a")).toHaveAttribute("href", "/config");
    expect(screen.getByText("kaanch-ka-mahal:e11").closest("a"))
      .toHaveAttribute("href", "/catalog/kaanch-ka-mahal");
    expect(screen.getByText("ceo-sahab").closest("a"))
      .toHaveAttribute("href", "/catalog/ceo-sahab");
    // an adjust ref stays plain text
    expect(screen.getByText("adjust:x1").closest("a")).toBeNull();
  });

  it("admins annotate an audit row; the note renders beside the chain", async () => {
    const { Audit } = await import("../src/views/Audit");
    let noted = false;
    const calls = stub({
      "/audit/7/note": () => { noted = true; return { id: 7 }; },
      ...SIGNALS,
      "/attention": () => ({ items: [] }),
      "/audit": () => ({ chain_ok: true, total: 1, rows: [
        { id: 7, ts: "2026-09-01T10:00:00+00:00", actor: "riya",
          action: "config.flag.set", entity: "store.web_enabled",
          change: "from=True, to=False", ip: "127.0.0.1",
          ...(noted ? { note: { note: "superseded — double-fire era",
                               by: "riya", at: "t" } } : {}) }] }),
    });
    renderWithStore(<Audit />);
    await screen.findByText("config.flag.set");
    await online();
    fireEvent.click(screen.getByTitle(/Annotate/));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Annotation"),
                     { target: { value: "superseded — double-fire era" } });
    fireEvent.click(within(dialog).getByText("Save note"));
    await screen.findByText(/✎ superseded — double-fire era/);
    const patch = calls.find((c) => c.url.includes("/audit/7/note"));
    expect(JSON.parse(String(patch?.init?.body)))
      .toEqual({ note: "superseded — double-fire era" });
  });
});

describe("comms: Outbox view + drop pushes", () => {
  it("lists the outbox with transport truth and expands a row", async () => {
    const { Outbox } = await import("../src/views/Outbox");
    stub({
      ...SIGNALS,
      "/outbox": () => ({
        transports: { email: false, push: true },
        rows: [
          { id: 2, kind: "push", recipient: "devtok-abc…", subject: "Kaanch Ka Mahal",
            body: '{"aps":{}}', status: "sent", detail: "",
            created_at: "2026-09-01T10:00:00+00:00" },
          { id: 1, kind: "email", recipient: "meera@example.com",
            subject: "Your Katha invoice KATHA-INV-2627-000001",
            body: "<div>invoice</div>", status: "failed", detail: "relay refused",
            created_at: "2026-09-01T09:00:00+00:00" }],
      }),
    });
    renderWithStore(<Outbox />);
    await screen.findByText("meera@example.com");
    expect(screen.getByText(/push APNs/)).toBeInTheDocument();
    expect(screen.getByText("sent")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("relay refused")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/invoice KATHA-INV/));
    await screen.findByText("<div>invoice</div>");
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "push" } });
    await waitFor(() => expect(screen.getByLabelText("Kind")).toHaveValue("push"));
  });

  it("Notify drop… posts the episode and reports device count", async () => {
    const calls = stub({
      "/notify-drop": () => ({ slug: "kaanch-ka-mahal", episode: 60, devices: 3 }),
      ...SIGNALS,
      "/attention": () => ({ items: [] }),
      "/approvals": () => [],
      "/audit": () => ({ rows: [], chain_ok: true, total: 0 }),
      "/config/flags": () => [],
      "/catalog/series/kaanch-ka-mahal": () => ({
        slug: "kaanch-ka-mahal", title: "Kaanch Ka Mahal", synopsis: "s",
        genres: ["Drama"], language: "Hindi", episodeCount: 60, freeEpisodes: 10,
        coinPrice: 30, bundleDiscountPct: 25, status: "live", rating: "U/A 13+",
        ratingHistory: {}, updatedAt: "", coverUrl: "x", pricingOverridden: false,
        rights: { owner: "Katha Originals", license_until: "" },
        media: { covers_ok: true, episodes_with_media: 60, episodes_missing: 0 },
        episodes: [{ number: 1, title: "One", isFree: true, hasMedia: true }],
        previewWeb: "http://x/w",
      }),
    });
    renderWithStore(
      <Routes><Route path="/catalog/:slug" element={<CatalogDetail />} /></Routes>,
      { route: "/catalog/kaanch-ka-mahal" });
    await screen.findByText("Kaanch Ka Mahal");
    await online();
    fireEvent.click(screen.getByText("Notify drop…"));
    const dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Drop episode"),
                     { target: { value: "60" } });
    fireEvent.click(within(dlg).getByText("Send push"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text.includes("pushed to 3 device(s)"))).toBe(true));
    const post = calls.find((c) => c.url.includes("/notify-drop"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ episode: 60 });
  });
});

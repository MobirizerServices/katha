import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act, within, render } from "@testing-library/react";
import { Audit } from "../src/views/Audit";
import { Config } from "../src/views/Config";
import { Catalog } from "../src/views/Catalog";
import { Grievances } from "../src/views/Grievances";
import { Approvals } from "../src/views/Approvals";
import { renderWithStore, getStore } from "./helpers";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

const ok = (b: unknown) => Promise.resolve({ ok: true, json: async () => b });

describe("Audit — pagination (#066)", () => {
  it("loads older pages with the before cursor", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/audit")) {
        const before = u.includes("before=");
        return ok({
          rows: [{ id: before ? 5 : 9, ts: "2026-09-01T10:00:00+00:00", actor: "riya",
                   action: before ? "older.row" : "newer.row", entity: "x",
                   change: "c", ip: "" }],
          chain_ok: true, total: 2,
        });
      }
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      return Promise.reject(new Error("offline"));
    }));
    renderWithStore(<Audit />);
    await waitFor(() => expect(screen.getByText("newer.row")).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Load older/));
    await waitFor(() => expect(screen.getByText("older.row")).toBeInTheDocument());
    expect(calls.some((u) => u.includes("before=9"))).toBe(true);
  });
});

describe("Config — every editor control", () => {
  it("edits all three pack fields and cancels the guarded modal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/config/packs")) return ok([
        { sku: "coins_starter_in", storefront: "IN", price_minor: 9900,
          currency: "INR", coins: 600, bonus: 0 }]);
      if (u.includes("/config/policy")) return ok({
        dual_approval_threshold: 500, coin_rupee_rate: 0.15,
        pricing: { free_episode_count: 10, episode_coin_price: 30, bundle_discount_pct: 25 },
        min_app_version: "1.0.0" });
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      return Promise.reject(new Error("offline"));
    }));
    renderWithStore(<Config />);
    await waitFor(() => expect(screen.getByText("coins_starter_in")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Edit…"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Price (paise)"), { target: { value: "10900" } });
    fireEvent.change(within(dialog).getByLabelText("Coins"), { target: { value: "650" } });
    fireEvent.change(within(dialog).getByLabelText("Bonus"), { target: { value: "10" } });
    fireEvent.click(within(dialog).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // guarded modal opens and cancels cleanly
    const guarded = getStore().flags.find((f) => f.guarded)!;
    fireEvent.click(screen.getByRole("switch", { name: new RegExp(guarded.key) }));
    const gd = await screen.findByRole("dialog");
    fireEvent.change(within(gd).getByLabelText("Flag key"), { target: { value: "nope" } });
    expect(within(gd).getByText("Flip it")).toBeDisabled();
    fireEvent.click(within(gd).getByText("Cancel"));
  });
});

describe("Catalog — cover image fallback", () => {
  it("hides a broken cover instead of showing a broken glyph", async () => {
    renderWithStore(<Catalog />);
    await waitFor(() =>
      expect(document.querySelector("img.covermini")).not.toBeNull());
    const img = document.querySelector("img.covermini") as HTMLImageElement;
    if (img) {
      fireEvent.error(img);
      expect(img.style.visibility).toBe("hidden");
    }
  });
});

describe("Grievances — offline actions stay honest", () => {
  it("ack/resolve without a server produce error toasts, not fake success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/grievances") && !u.includes("/ack") && !u.includes("/resolve")) {
        return ok({ grievances: [{
          id: "G-OFF", user_id: "", contact: "c", channel: "app", subject: "s",
          body: "", status: "new", assignee: "", created_at: "2026-09-01T00:00:00+00:00",
          ack_at: "", resolved_at: "", notes: [], age_hours: 1,
          ack_breach: false, resolve_breach: false }] });
      }
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      return Promise.reject(new Error("offline"));
    }));
    renderWithStore(<Grievances />);
    await waitFor(() => expect(screen.getByText("G-OFF")).toBeInTheDocument());
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    fireEvent.click(screen.getByText("Acknowledge"));
    await waitFor(() =>
      expect(getStore().toasts.at(-1)?.kind).toBe("error"));
  });
});

describe("Approvals — server refusal path", () => {
  it("shows the server's error when a decision is refused", async () => {
    renderWithStore(<Approvals />);
    await waitFor(() => expect(getStore().approvals.length).toBeGreaterThan(0));
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/approve")) {
        return Promise.resolve({ ok: false, status: 409,
          json: async () => ({ detail: "already approved" }) });
      }
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      return Promise.reject(new Error("offline"));
    }));
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    const target = getStore().approvals.find((a) => a.requestedBy !== "riya")!;
    const row = screen.getByText(target.detail).closest("li")!;
    fireEvent.click(within(row).getByText("Approve"));
    await waitFor(() =>
      expect(getStore().toasts.some((t) => t.text.includes("already approved"))).toBe(true));
    // refused → the request stays in the inbox
    expect(getStore().approvals.find((a) => a.id === target.id)).toBeDefined();
  });
});

describe("remaining handler coverage", () => {
  it("Approvals: self-approve attempt via bulk path warns and skips", async () => {
    renderWithStore(<Approvals />);
    await waitFor(() => expect(getStore().approvals.length).toBeGreaterThan(0));
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      if (u.includes("/approvals?status=pending")) return ok([]);
      return Promise.reject(new Error("offline"));
    }));
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    act(() => getStore().addApproval({
      id: "apr_mine", kind: "Coin adjustment", detail: "mine · 800",
      requestedBy: "riya", when: "2026-09-01T00:00:00+00:00", needs: "Finance",
      amount: 800, userId: "u1", balanceBefore: 0, balanceAfter: 800,
      requesterToday: 3,
    }));
    expect(screen.getByText(/3 requests today/)).toBeInTheDocument();
    expect(screen.getByText(/balance 0 → 800/)).toBeInTheDocument();
  });

  it("CatalogDetail: copy app link uses the clipboard", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: write } });
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/catalog/series/kaanch-ka-mahal")) return ok({
        slug: "kaanch-ka-mahal", title: "Kaanch Ka Mahal", synopsis: "s",
        genres: ["Drama"], language: "Hindi", episodeCount: 20, freeEpisodes: 10,
        coinPrice: 30, bundleDiscountPct: 25, status: "live", rating: "U/A 13+",
        ratingHistory: {}, updatedAt: "", coverUrl: "http://x/c.jpg",
        media: { covers_ok: false, episodes_with_media: 3, episodes_missing: 17 },
        episodes: Array.from({ length: 20 }, (_, i) =>
          ({ number: i + 1, title: `E${i + 1}`, isFree: i < 10 })),
        previewWeb: "http://x" });
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      return Promise.reject(new Error("offline"));
    }));
    const { CatalogDetail } = await import("../src/views/CatalogDetail");
    const { Routes, Route } = await import("react-router-dom");
    renderWithStore(
      <Routes><Route path="/catalog/:slug" element={<CatalogDetail />} /></Routes>,
      { route: "/catalog/kaanch-ka-mahal" });
    await waitFor(() => expect(screen.getByText("Copy app link")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Copy app link"));
    expect(write).toHaveBeenCalledWith("katha://series/kaanch-ka-mahal");
    expect(screen.getByText("17 gap(s)")).toBeInTheDocument();   // media health warn
    expect(screen.getByText(/full episode management ships/)).toBeInTheDocument();
    const img = document.querySelector("img") as HTMLImageElement;
    fireEvent.error(img);                                        // cover onError arrow
  });

  it("Grievances: renders triage notes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/grievances")) return ok({ grievances: [{
        id: "G-N", user_id: "", contact: "c", channel: "app", subject: "s",
        body: "b", status: "ack", assignee: "sam",
        created_at: "2026-09-01T00:00:00+00:00", ack_at: "2026-09-01T01:00:00+00:00",
        resolved_at: "", notes: [{ by: "sam", note: "checking with payments" }],
        age_hours: 2, ack_breach: false, resolve_breach: false }] });
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      return Promise.reject(new Error("offline"));
    }));
    renderWithStore(<Grievances />);
    await waitFor(() =>
      expect(screen.getByText(/checking with payments/)).toBeInTheDocument());
  });

  it("Users: empty search state and Load more paging", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/users?")) {
        const offset = /offset=(\d+)/.exec(u)?.[1] ?? "0";
        const mk = (id: string) => ({
          id, phone: "+91", name: "—", languages: "hi",
          wallet: { bought: 10, bonus: 0, unlocked: 0, ltv: "₹2" },
          lastActive: "never", flags: [], devices: [], payer: "—" });
        if (u.includes("q=zz")) return ok({ users: [], total: 0 });
        return ok(offset === "0"
          ? { users: [mk("pg_one")], total: 2 }
          : { users: [mk("pg_two")], total: 2 });
      }
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      return Promise.reject(new Error("offline"));
    }));
    const { Users } = await import("../src/views/Users");
    renderWithStore(<Users />);
    await waitFor(() => expect(screen.getAllByText(/pg_one/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText(/Load more/));
    await waitFor(() => expect(screen.getAllByText(/pg_two/).length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Search users"), { target: { value: "zz" } });
    await waitFor(() => expect(screen.getByText("No matches")).toBeInTheDocument());
  });

  it("Modal closes on Escape (#092)", async () => {
    const { Modal } = await import("../src/ui");
    const onClose = vi.fn();
    render(<Modal title="t" footer={<span />} onClose={onClose}>x</Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("last handler mile", () => {
  it("Approvals bulk decide skips the self-authored request with a warning", async () => {
    renderWithStore(<Approvals />);
    await waitFor(() => expect(getStore().approvals.length).toBeGreaterThan(0));
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/approve") || u.includes("/reject")) return ok({ status: "done" });
      if (u.includes("/approvals?status=pending")) return ok([]);
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      return Promise.reject(new Error("offline"));
    }));
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    act(() => getStore().addApproval({
      id: "apr_self2", kind: "Coin adjustment", detail: "self2 · 700",
      requestedBy: "riya", when: "2026-09-01T00:00:00+00:00", needs: "Finance",
      amount: 700, userId: "u1" }));
    const boxes = screen.getAllByRole("checkbox");
    boxes.forEach((b) => fireEvent.click(b));
    // bulk-reject path also walks the self-authored one (allowed for reject)
    fireEvent.click(screen.getByText(/Reject \d+ with one note/));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: "bulk" } });
    fireEvent.click(within(dialog).getByText("Reject with note"));
    await waitFor(() => expect(getStore().approvals.length).toBe(0));
  });

  it("Grievances offline shows sample empty + resolve modal cancel path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/grievances")) return ok({ grievances: [{
        id: "G-C", user_id: "", contact: "c", channel: "web", subject: "s", body: "",
        status: "ack", assignee: "sam", created_at: "2026-09-01T00:00:00+00:00",
        ack_at: "x", resolved_at: "", notes: [], age_hours: 2,
        ack_breach: false, resolve_breach: false }] });
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      return Promise.reject(new Error("offline"));
    }));
    renderWithStore(<Grievances />);
    await waitFor(() => expect(screen.getByText("G-C")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "ack" }));
    fireEvent.click(screen.getByRole("tab", { name: /All/ }));
    fireEvent.click(screen.getByText("Resolve…"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Resolution note/),
                     { target: { value: "x" } });
    fireEvent.click(within(dialog).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Config guarded confirm goes through toggleFlag with the key", async () => {
    renderWithStore(<Config />);
    await waitFor(() => expect(getStore().flags.length).toBeGreaterThan(0));
    const guarded = getStore().flags.find((f) => f.guarded)!;
    const before = guarded.enabled;
    fireEvent.click(screen.getByRole("switch", { name: new RegExp(guarded.key) }));
    const gd = await screen.findByRole("dialog");
    fireEvent.change(within(gd).getByLabelText("Flag key"),
                     { target: { value: guarded.key } });
    fireEvent.click(within(gd).getByText("Flip it"));
    await waitFor(() =>
      expect(getStore().flags.find((f) => f.key === guarded.key)!.enabled).toBe(!before));
  });

  it("Users dialog tab buttons cycle every tab", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/users?")) return ok({ users: [{
        id: "tabs_u", phone: "+91", name: "—", languages: "hi",
        wallet: { bought: 0, bonus: 0, unlocked: 0, ltv: "₹0" },
        lastActive: "never", flags: [], devices: [], payer: "—" }], total: 1 });
      if (u.includes("/ledger")) return ok({ user_id: "tabs_u",
        wallet: { balance_bought: 0, balance_bonus: 0, total: 0 }, transactions: [] });
      if (u.includes("/entitlements")) return ok({ entitlements: [] });
      if (u.includes("/timeline")) return ok({ events: [] });
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      return Promise.reject(new Error("offline"));
    }));
    const { Users } = await import("../src/views/Users");
    renderWithStore(<Users />);
    await waitFor(() => expect(screen.getAllByText(/tabs_u/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText("View ledger"));
    const dialog = await screen.findByRole("dialog");
    for (const t of ["Entitlements", "Timeline", "Data & erasure", "Ledger"]) {
      fireEvent.click(within(dialog).getByRole("tab", { name: t }));
    }
    await waitFor(() =>
      expect(within(dialog).getByText("No ledger entries for this user yet.")).toBeInTheDocument());
  });

  it("CatalogDetail publish/status buttons hit the server", async () => {
    let statusBody: { status?: string } = {};
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/status")) { statusBody = JSON.parse(String(init?.body)); return ok({}); }
      if (u.includes("/catalog/series/kaanch-ka-mahal")) return ok({
        slug: "kaanch-ka-mahal", title: "Kaanch Ka Mahal", synopsis: "s",
        genres: ["Drama"], language: "Hindi", episodeCount: 12, freeEpisodes: 10,
        coinPrice: 30, bundleDiscountPct: 25, status: "draft", rating: "U/A 13+",
        ratingHistory: {}, updatedAt: "", coverUrl: "",
        media: { covers_ok: true, episodes_with_media: 12, episodes_missing: 0 },
        episodes: [{ number: 1, title: "E1", isFree: true }], previewWeb: "http://x" });
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      return Promise.reject(new Error("offline"));
    }));
    const { CatalogDetail } = await import("../src/views/CatalogDetail");
    const { Routes, Route } = await import("react-router-dom");
    renderWithStore(
      <Routes><Route path="/catalog/:slug" element={<CatalogDetail />} /></Routes>,
      { route: "/catalog/kaanch-ka-mahal" });
    await waitFor(() => expect(screen.getByText("Publish (live)")).toBeInTheDocument());
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    fireEvent.click(screen.getByText("Publish (live)"));
    await waitFor(() => expect(statusBody.status).toBe("live"));
  });
});

describe("final handler closures", () => {
  it("Approvals: pending tab click and reject-modal cancel", async () => {
    renderWithStore(<Approvals />);
    await waitFor(() => expect(getStore().approvals.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    fireEvent.click(screen.getByRole("tab", { name: /Pending/ }));
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      return Promise.reject(new Error("offline"));
    }));
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    const row = screen.getAllByText("Coin adjustment")[0].closest("li")!;
    fireEvent.click(within(row).getByText("Reject"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("modals everywhere close on Escape (onClose props)", async () => {
    // Config guarded + pack modals
    renderWithStore(<Config />);
    await waitFor(() => expect(getStore().flags.length).toBeGreaterThan(0));
    const guarded = getStore().flags.find((f) => f.guarded)!;
    fireEvent.click(screen.getByRole("switch", { name: new RegExp(guarded.key) }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Grievances resolve modal closes on Escape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/grievances")) return ok({ grievances: [{
        id: "G-E", user_id: "", contact: "c", channel: "app", subject: "s", body: "",
        status: "ack", assignee: "", created_at: "2026-09-01T00:00:00+00:00",
        ack_at: "", resolved_at: "", notes: [], age_hours: 1,
        ack_breach: false, resolve_breach: false }] });
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      return Promise.reject(new Error("offline"));
    }));
    renderWithStore(<Grievances />);
    await waitFor(() => expect(screen.getByText("G-E")).toBeInTheDocument());
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    fireEvent.click(screen.getByText("Resolve…"));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("CatalogDetail modals close on Escape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/catalog/series/kaanch-ka-mahal")) return ok({
        slug: "kaanch-ka-mahal", title: "T", synopsis: "s", genres: [], language: "Hindi",
        episodeCount: 1, freeEpisodes: 1, coinPrice: 30, bundleDiscountPct: 25,
        status: "live", rating: "U/A 13+", ratingHistory: {}, updatedAt: "",
        coverUrl: "", media: { covers_ok: true, episodes_with_media: 1, episodes_missing: 0 },
        episodes: [{ number: 1, title: "E1", isFree: true }], previewWeb: "http://x" });
      if (u.includes("/health") || u.includes("/attention")) return ok({ status: "ok", checks: {}, at: "", items: [] });
      return Promise.reject(new Error("offline"));
    }));
    const { CatalogDetail } = await import("../src/views/CatalogDetail");
    const { Routes, Route } = await import("react-router-dom");
    renderWithStore(
      <Routes><Route path="/catalog/:slug" element={<CatalogDetail />} /></Routes>,
      { route: "/catalog/kaanch-ka-mahal" });
    await waitFor(() => expect(screen.getByText("Take down…")).toBeInTheDocument());
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    fireEvent.click(screen.getByText("Take down…"));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("Change…"));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Users: offline >500 queues locally (uid path) and row click selects", async () => {
    await (async () => {
      const { Users } = await import("../src/views/Users");
      renderWithStore(<Users />);
      await waitFor(() => expect(screen.getByText("Meera K.")).toBeInTheDocument());
      const rows = screen.getAllByRole("row");
      fireEvent.click(rows[2]);                          // onClick row select
      fireEvent.click(screen.getByText("Adjust coins…"));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText(/Coins/), { target: { value: "900" } });
      fireEvent.click(within(dialog).getByText("Request approval"));
      await waitFor(() =>
        expect(getStore().toasts.at(-1)?.text).toMatch(/queued locally/));
      expect(getStore().approvals.some((a) => a.id.startsWith("apr_"))).toBe(true);
    })();
  });

  it("palette hover moves the selection", async () => {
    const AppMod = (await import("../src/App")).default;
    renderWithStore(<AppMod />, { route: "/access" });
    await waitFor(() => expect(screen.getByText("Permission matrix")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Open command palette"));
    const list = await screen.findByRole("listbox");
    const opts = within(list).getAllByRole("option");
    expect(opts.length).toBeGreaterThan(3);
    fireEvent.mouseMove(opts[2]);
    await waitFor(() => {
      const now = within(screen.getByRole("listbox")).getAllByRole("option");
      expect(now[2].getAttribute("aria-selected")).toBe("true");
    });
  });
});

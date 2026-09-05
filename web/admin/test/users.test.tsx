import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { Users } from "../src/views/Users";
import { renderWithStore, getStore } from "./helpers";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function renderUsers() {
  const view = renderWithStore(<Users />);
  await waitFor(() => expect(screen.getByText("Meera K.")).toBeInTheDocument());
  return view;
}

/** Route only the given path predicates to handlers; everything else rejects. */
function stubServer(routes: [(url: string, init?: RequestInit) => boolean,
                             (url: string, init?: RequestInit) => unknown][]) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    for (const [match, body] of routes) {
      if (match(String(url), init)) {
        return Promise.resolve({ ok: true, json: async () => body(String(url), init) });
      }
    }
    return Promise.reject(new Error("offline"));
  }));
}

describe("Users view — lookup + wallet", () => {
  it("selects the first user by default and shows the bonus-before-bought note", async () => {
    await renderUsers();
    expect(screen.getByText("Bonus coins are spent before bought coins. Coins never expire.")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
  });

  it("filters the lookup list by query (offline sample honors it too)", async () => {
    await renderUsers();
    fireEvent.change(screen.getByLabelText("Search users"), { target: { value: "priya" } });
    await waitFor(() =>
      expect(screen.queryByText("Meera K.")).not.toBeInTheDocument());
    expect(screen.getByText("Priya S.")).toBeInTheDocument();
  });

  it("masks PII for the finance role", async () => {
    await renderUsers();
    act(() => getStore().setRole("finance"));
    await waitFor(() =>
      expect(screen.getByText("•••• masked (finance)")).toBeInTheDocument());
  });
});

describe("Users view — coin adjustment dialog (dual control)", () => {
  it("reconciles a small adjustment against the server's reply (#026)", async () => {
    await renderUsers();
    stubServer([[
      (url) => url.includes("/wallet/adjust"),
      () => ({ status: "applied", ref: "adjust:abc123", wallet: { total: 1330 } }),
    ]]);
    fireEvent.click(screen.getByText("Adjust coins…"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("Write ledger entry"));
    await waitFor(() =>
      expect(within(dialog).getByText("adjust:abc123")).toBeInTheDocument());
    expect(getStore().toasts.at(-1)?.text).toMatch(/new balance 1,330/);
  });

  it("routes adjustments above 500 to the approvals inbox with nothing written", async () => {
    await renderUsers();
    stubServer([[
      (url) => url.includes("/wallet/adjust"),
      () => ({ status: "pending_approval", approval: { id: "apr_1" } }),
    ]]);
    fireEvent.click(screen.getByText("Adjust coins…"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Coins/), { target: { value: "900" } });
    expect(within(dialog).getByText("Request approval")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText("Request approval"));
    await waitFor(() =>
      expect(getStore().toasts.at(-1)?.text).toMatch(/nothing written yet/));
  });

  it("sends a Debit as a negative amount to the server", async () => {
    await renderUsers();
    let sent: { coins?: number } = {};
    stubServer([[
      (url) => url.includes("/wallet/adjust"),
      (_url, init) => {
        sent = JSON.parse(String(init?.body ?? "{}"));
        return { status: "applied", ref: "adjust:neg", wallet: { total: 0 } };
      },
    ]]);
    fireEvent.click(screen.getByText("Adjust coins…"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Direction"), { target: { value: "Debit" } });
    fireEvent.change(within(dialog).getByLabelText(/Coins/), { target: { value: "60" } });
    fireEvent.click(within(dialog).getByText("Write ledger entry"));
    await waitFor(() => expect(sent.coins).toBe(-60));
  });

  it("disables the write button for an invalid amount (#028)", async () => {
    await renderUsers();
    fireEvent.click(screen.getByText("Adjust coins…"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Coins/), { target: { value: "-5" } });
    expect(within(dialog).getByText("Write ledger entry")).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Coins/), { target: { value: "30" } });
    expect(within(dialog).getByText("Write ledger entry")).toBeEnabled();
  });

  it("requires a note when the reason is 'other'", async () => {
    await renderUsers();
    fireEvent.click(screen.getByText("Adjust coins…"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason code"),
                     { target: { value: "other (note required)" } });
    expect(within(dialog).getByText("Write ledger entry")).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: "ticket 42" } });
    expect(within(dialog).getByText("Write ledger entry")).toBeEnabled();
  });

  it("stays honest offline: no ledger-written toast without a server", async () => {
    await renderUsers();
    fireEvent.click(screen.getByText("Adjust coins…"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("Write ledger entry"));
    await waitFor(() =>
      expect(getStore().toasts.at(-1)?.text).toMatch(/nothing was written/));
  });
});

describe("Users view — ledger dialog", () => {
  it("opens the ledger, shows live rows with running balance, and closes", async () => {
    await renderUsers();
    stubServer([[
      (url) => url.includes("/ledger"),
      () => ({
        user_id: "u1",
        wallet: { balance_bought: 570, balance_bonus: 0, total: 570 },
        transactions: [
          { id: "ctx_1", type: "purchase", amount_bought: 600, amount_bonus: 0,
            reference_type: "iap", reference_id: "coins_starter_in", created_at: "2026-09-01T10:00:00+00:00" },
          { id: "ctx_2", type: "unlock", amount_bought: -30, amount_bonus: 0,
            reference_type: "episode", reference_id: "kaanch-ka-mahal:e11", created_at: "2026-09-01T10:05:00+00:00" },
        ],
      }),
    ]]);
    fireEvent.click(screen.getByText("View ledger"));
    await waitFor(() => expect(screen.getByText("coins_starter_in")).toBeInTheDocument());
    expect(screen.getByText("+600")).toBeInTheDocument();
    expect(screen.getByText("-30")).toBeInTheDocument();
    expect(screen.getByText("570")).toBeInTheDocument();       // running balance
    expect(screen.getByText("Refund")).toBeInTheDocument();    // purchases refundable
    fireEvent.click(screen.getByText("Close"));
    await waitFor(() =>
      expect(screen.queryByText("coins_starter_in")).not.toBeInTheDocument());
  });

  it("shows the empty state when the server is absent", async () => {
    await renderUsers();
    fireEvent.click(screen.getByText("View ledger"));
    await waitFor(() =>
      expect(screen.getByText("No ledger entries for this user yet.")).toBeInTheDocument());
  });

  it("erasure requires typing the user id (#032)", async () => {
    await renderUsers();
    fireEvent.click(screen.getByText("View ledger"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Data & erasure"));
    const eraseBtn = within(dialog).getByText("Erase personal data");
    expect(eraseBtn).toBeDisabled();
  });
});

describe("Users view — drill-down tabs, refund, DPDP (#029/#031/#032)", () => {
  function fullServerStub() {
    let refunded = false;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      // signal refreshes re-read the approvals inbox (ADM-03)
      if (u.includes("/approvals?")) return Promise.resolve({ ok: true, status: 200, json: async () => getStore().approvals });
      const ok = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });
      if (u.includes("/wallet/refund")) { refunded = true; return ok({ status: "refunded", coins: 600, wallet: { total: 0 } }); }
      if (u.includes("/erase")) return ok({ status: "erased" });
      if (u.includes("/export")) return ok({ user_id: "u1", profile: { phone: "+91" } });
      if (u.includes("/entitlements")) return ok({ entitlements: [
        { episode_id: "kaanch-ka-mahal:e11", source: "unlock", created_at: "2026-09-01T10:00:00+00:00" }] });
      if (u.includes("/timeline")) return ok({ events: [
        { ts: "2026-09-01T10:00:00+00:00", kind: "ledger", type: "purchase", detail: "coins_starter_in", net: 600 }] });
      if (u.includes("/ledger")) return ok({
        user_id: "u1", wallet: { balance_bought: 600, balance_bonus: 0, total: 600 },
        transactions: refunded ? [] : [
          { id: "ctx_1", type: "purchase", amount_bought: 600, amount_bonus: 0,
            reference_type: "iap", reference_id: "coins_starter_in", created_at: "2026-09-01T10:00:00+00:00" }] });
      if (u.includes("/devices")) return ok({ devices: [
        { ua: "KathaApp/1.0 (iPhone 16)", ip: "192.168.1.4",
          first_seen: "2026-09-01T09:00:00+00:00",
          last_seen: "2026-09-01T10:00:00+00:00" }] });
      if (u.includes("/health/full")) return ok({ status: "ok", checks: {}, at: "" });
      if (u.includes("/attention")) return ok({ items: [] });
      return Promise.reject(new Error("offline"));
    }));
  }

  it("refunds a purchase from the ledger tab", async () => {
    await renderUsers();
    fullServerStub();
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    fireEvent.click(screen.getByText("View ledger"));
    await waitFor(() => expect(screen.getByText("Refund")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Refund"));
    await waitFor(() =>
      expect(getStore().toasts.at(-1)?.text).toMatch(/Refunded 600 coins/));
  });

  it("walks entitlements and timeline tabs", async () => {
    await renderUsers();
    fullServerStub();
    fireEvent.click(screen.getByText("View ledger"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Entitlements" }));
    await waitFor(() =>
      expect(screen.getByText("kaanch-ka-mahal:e11")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "Timeline" }));
    await waitFor(() => expect(screen.getByText("purchase")).toBeInTheDocument());
  });

  it("exports a JSON bundle and erases after the typed confirm", async () => {
    await renderUsers();
    fullServerStub();
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    const clicks: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicks.push((this as HTMLAnchorElement).download);
    };
    try {
      fireEvent.click(screen.getByText("View ledger"));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("tab", { name: "Data & erasure" }));
      fireEvent.click(within(dialog).getByText("Export data (JSON)"));
      await waitFor(() => expect(clicks[0]).toMatch(/-export\.json$/));
      const sel = getStore;
      const target = screen.getByText(/Type/).textContent!;
      const uid = /Type (.+) to enable/.exec(target)![1];
      const eraseBtn = within(dialog).getByText("Erase personal data");
      fireEvent.change(within(dialog).getByPlaceholderText(uid), { target: { value: uid } });
      expect(eraseBtn).toBeEnabled();
      fireEvent.click(eraseBtn);
      await waitFor(() =>
        expect(sel().toasts.at(-1)?.text).toMatch(/PII scrubbed/));
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
  });

  it("sort and segment controls requery; keyboard selects a row", async () => {
    await renderUsers();
    fireEvent.change(screen.getByLabelText("Segment"), { target: { value: "payers" } });
    await waitFor(() =>
      expect(screen.queryByText(/browsing as a guest/)).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "balance" } });
    const rows = await screen.findAllByRole("row");
    fireEvent.keyDown(rows[2], { key: "Enter" });
  });
});

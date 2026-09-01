import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { Config } from "../src/views/Config";
import { renderWithStore, getStore } from "./helpers";
import { MOCK_FLAGS } from "../src/api/mock";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function renderConfig() {
  const view = renderWithStore(<Config />);
  await waitFor(() => expect(getStore().flags.length).toBeGreaterThan(0));
  return view;
}

describe("Config view", () => {
  it("renders all feature flags and the pricing policy", async () => {
    await renderConfig();
    for (const f of MOCK_FLAGS.slice(0, 4)) {
      expect(screen.getByText(f.key)).toBeInTheDocument();
    }
    await waitFor(() =>
      expect(screen.getByText(/coins\/episode/)).toBeInTheDocument());
    expect(screen.getByText("Version history")).toBeInTheDocument();
  });

  it("admin can toggle an unguarded flag; aria-checked flips and it is audited", async () => {
    await renderConfig();
    const plain = getStore().flags.find((f) => !f.guarded)!;
    const sw = screen.getByRole("switch", { name: new RegExp(plain.key) });
    const before = sw.getAttribute("aria-checked");
    fireEvent.click(sw);
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: new RegExp(plain.key) })
        .getAttribute("aria-checked")).not.toBe(before));
    expect(getStore().audit[0]).toMatchObject({ action: "flag.update", entity: plain.key });
  });

  it("guarded flags demand a typed confirmation (#057)", async () => {
    await renderConfig();
    const guarded = getStore().flags.find((f) => f.guarded)!;
    const before = guarded.enabled;
    fireEvent.click(screen.getByRole("switch", { name: new RegExp(guarded.key) }));
    const dialog = await screen.findByRole("dialog");
    const flip = within(dialog).getByText("Flip it");
    expect(flip).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Flag key"),
                     { target: { value: guarded.key } });
    fireEvent.click(flip);
    await waitFor(() =>
      expect(getStore().flags.find((f) => f.key === guarded.key)!.enabled).toBe(!before));
  });

  it("non content/admin roles cannot toggle flags", async () => {
    await renderConfig();
    act(() => getStore().setRole("support"));
    const sw = screen.getAllByRole("switch")[0];
    expect(sw).toBeDisabled();
  });

  it("renders live packs with an edit affordance when the server answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/config/packs")) {
        return Promise.resolve({ ok: true, json: async () => ([
          { sku: "coins_starter_in", storefront: "IN", price_minor: 9900,
            currency: "INR", coins: 600, bonus: 0 },
        ]) });
      }
      if (u.includes("/health/full")) {
        return Promise.resolve({ ok: true, json: async () =>
          ({ status: "ok", checks: {}, at: "now" }) });
      }
      if (u.includes("/attention")) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      }
      return Promise.reject(new Error("offline"));
    }));
    renderWithStore(<Config />);
    await waitFor(() => expect(screen.getByText("coins_starter_in")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Edit…"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Save pack")).toBeDisabled();  // typed confirm (#059)
    fireEvent.change(within(dialog).getByLabelText("SKU"),
                     { target: { value: "coins_starter_in" } });
    expect(within(dialog).getByText("Save pack")).toBeEnabled();
  });
});

describe("Config — writes reach the server (#059/#060)", () => {
  function writeStub(calls: Record<string, unknown>) {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const ok = (b: unknown) => Promise.resolve({ ok: true, json: async () => b });
      if (u.includes("/config/packs/")) {
        calls.pack = JSON.parse(String(init?.body));
        return ok({ sku: "coins_starter_in", coins: 700 });
      }
      if (u.includes("/config/packs")) return ok([
        { sku: "coins_starter_in", storefront: "IN", price_minor: 9900,
          currency: "INR", coins: 600, bonus: 0 }]);
      if (u.includes("/config/values/app.min_version")) {
        calls.minver = JSON.parse(String(init?.body));
        return ok({ key: "app.min_version", value: "1.2.0" });
      }
      if (u.includes("/config/policy")) return ok({
        dual_approval_threshold: 500, coin_rupee_rate: 0.15,
        pricing: { free_episode_count: 10, episode_coin_price: 30, bundle_discount_pct: 25 },
        min_app_version: "1.0.0" });
      if (u.includes("/health/full")) return ok({ status: "ok", checks: {}, at: "" });
      if (u.includes("/attention")) return ok({ items: [] });
      return Promise.reject(new Error("offline"));
    }));
  }

  it("saves a pack with the typed confirm and reports core-api sees it", async () => {
    const calls: Record<string, unknown> = {};
    writeStub(calls);
    renderWithStore(<Config />);
    await waitFor(() => expect(screen.getByText("coins_starter_in")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Edit…"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Coins"), { target: { value: "700" } });
    fireEvent.change(within(dialog).getByLabelText("SKU"),
                     { target: { value: "coins_starter_in" } });
    fireEvent.click(within(dialog).getByText("Save pack"));
    await waitFor(() => expect((calls.pack as { coins: number }).coins).toBe(700));
    expect((calls.pack as { confirm: string }).confirm).toBe("coins_starter_in");
    expect(getStore().toasts.at(-1)?.text).toMatch(/core-api sells the new values/);
  });

  it("saves the typed min-version value", async () => {
    const calls: Record<string, unknown> = {};
    writeStub(calls);
    renderWithStore(<Config />);
    await waitFor(() =>
      expect(screen.getByLabelText(/Minimum app version/)).toHaveValue("1.0.0"));
    fireEvent.change(screen.getByLabelText(/Minimum app version/),
                     { target: { value: "1.2.0" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect((calls.minver as { value: string }).value).toBe("1.2.0"));
  });
});

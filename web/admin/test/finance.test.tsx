import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Finance, paise } from "../src/views/Finance";
import { renderWithStore, getStore, stubFetch, SIGNALS } from "./helpers";
import { ANALYTICS } from "./fixtures";

const INVOICES = {
  totals: { count: 2, gross_minor: 29800, gst_minor: 4546 },
  rows: [
    { id: "KATHA-INV-2627-000001", user_id: "u1", sku: "coins_web_popular_in",
      coins: 1300, bonus_coins: 130, total_minor: 19900,
      taxable_minor: 16864, gst_minor: 3036, gst_rate_pct: 18,
      created_at: "2026-09-01T10:00:00+00:00" },
    { id: "KATHA-INV-2627-000002", user_id: "u2", sku: "coins_starter_in",
      coins: 600, bonus_coins: 0, total_minor: 9900,
      taxable_minor: 8390, gst_minor: 1510, gst_rate_pct: 18,
      created_at: "2026-09-01T11:00:00+00:00" }],
};
const POLICY = { dual_approval_threshold: 500, coin_rupee_rate: 0.15,
                 pricing: { free_episode_count: 10, episode_coin_price: 30, bundle_discount_pct: 25 },
                 min_app_version: "1.0.0" };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Finance board", () => {
  it("formats paise", () => {
    expect(paise(19900)).toBe("₹199.00");
    expect(paise(5)).toBe("₹0.05");
  });

  it("composes ledger figures, approvals, policy and the GST register", async () => {
    stubFetch({
      ...SIGNALS,
      "/approvals": () => [{ id: "apr_1", kind: "Coin adjustment", detail: "d",
                             requestedBy: "sam", when: "t", needs: "Finance" }],
      "/invoices": () => INVOICES,
      "/analytics": () => ANALYTICS,
      "/config/policy": () => POLICY,
    });
    renderWithStore(<Finance />);
    await screen.findByText("KATHA-INV-2627-000001");
    expect(screen.getByText("Revenue · 30d")).toBeInTheDocument();   // ADM-33: short label
    expect(screen.getByText("6.67%")).toBeInTheDocument();          // over 2% → danger
    expect(screen.getByText("≈ ₹154")).toBeInTheDocument();
    expect(screen.getByText(/77 coins dormant/)).toBeInTheDocument();
    await waitFor(() => expect(getStore().approvals.length).toBe(1));
    expect(screen.getByText("Approvals inbox (1)")).toBeInTheDocument();
    expect(screen.getByText("18%")).toBeInTheDocument();
    expect(screen.getByText("₹0.15 per coin")).toBeInTheDocument();
    expect(screen.getByText(/gross ₹298.00/)).toBeInTheDocument();
    expect(screen.getByText(/GST ₹45.46/)).toBeInTheDocument();
    expect(screen.getByText("₹30.36")).toBeInTheDocument();
    expect(screen.getByText("1,300 +130 coins")).toBeInTheDocument();
    expect(screen.getByText("600 coins")).toBeInTheDocument();
    expect(screen.getByText("Export CSV").getAttribute("href")).toContain("/invoices.csv");
  });

  it("without the persisted ledger it says so, and the register is empty", async () => {
    stubFetch({
      ...SIGNALS,
      "/invoices": () => ({ rows: [], totals: { count: 0, gross_minor: 0, gst_minor: 0 } }),
      "/analytics": () => ({ __status: 503, detail: "needs persistence" }),
      "/config/policy": () => POLICY,
    });
    renderWithStore(<Finance />);
    await screen.findByText(/need the persisted ledger/);
    expect(screen.getByText(/register fills with the first UPI purchase/)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();     // no GST rate to quote
  });

  it("a healthy refund ratio renders as ok", async () => {
    const healthy = { ...ANALYTICS, windows: { ...ANALYTICS.windows,
      "30d": { current: { ...ANALYTICS.windows["30d"].current, refund_ratio_pct: 0.5 },
               previous: ANALYTICS.windows["30d"].previous } } };
    stubFetch({ ...SIGNALS, "/invoices": () => INVOICES, "/analytics": () => healthy,
                "/config/policy": () => POLICY });
    renderWithStore(<Finance />);
    const chip = await screen.findByText("0.5%");
    expect(chip.className).toContain("sev-ok");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { Analytics } from "../src/views/Analytics";
import { renderWithStore, stubFetch, SIGNALS } from "./helpers";
import { ANALYTICS, W } from "./fixtures";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Analytics — the full business board", () => {
  it("says when the rollup is unavailable", async () => {
    renderWithStore(<Analytics />);
    await screen.findByText("Analytics unavailable");
  });

  it("renders windowed metrics with deltas, funnel, split, liability and the day table", async () => {
    stubFetch({ ...SIGNALS, "/analytics": () => ANALYTICS });
    renderWithStore(<Analytics />);
    await screen.findByText("The business");
    expect(screen.getByText("₹1,000")).toBeInTheDocument();          // 7d default
    expect(screen.getByText(/▲ 100%/)).toBeInTheDocument();
    expect(screen.getByText("Saw the paywall")).toBeInTheDocument();
    expect(screen.getByText(/60% drop/)).toBeInTheDocument();
    expect(screen.getByText(/App Store 67%/)).toBeInTheDocument();
    expect(screen.getByText("6.67%")).toBeInTheDocument();
    expect(screen.getByText("1,029 coins")).toBeInTheDocument();
    expect(screen.getByText(/77 coins dormant/)).toBeInTheDocument();
    expect(screen.getByText("2026-08-30")).toBeInTheDocument();      // day table
    // ADM-12: the stamp is humanised, the ISO form stays on hover
    expect(screen.getByTitle("2026-09-01T18:00:00+00:00")).toBeInTheDocument();
  });

  it("the window switcher changes the period", async () => {
    stubFetch({ ...SIGNALS, "/analytics": () => ANALYTICS });
    renderWithStore(<Analytics />);
    await screen.findByText("The business");
    fireEvent.click(screen.getByText("Today"));
    expect(screen.getByText("₹225")).toBeInTheDocument();
    expect(screen.getAllByText(/▲ 50%/).length).toBeGreaterThan(0);   // 225 vs 150
    expect(screen.getByText(/unlock \(1d\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("30d"));
    expect(screen.getAllByText(/±0%/).length).toBeGreaterThan(0);
  });

  it("handles an empty liability trend and a zero-revenue period", async () => {
    const quiet = { ...ANALYTICS, outstanding_trend: [],
      windows: { ...ANALYTICS.windows,
        "7d": { current: W({ coins_purchased: 0, revenue_rupees: 0, coins_iap: 0 }),
                previous: W({ coins_purchased: 0, revenue_rupees: 0 }) } } };
    stubFetch({ ...SIGNALS, "/analytics": () => quiet });
    renderWithStore(<Analytics />);
    await screen.findByText("The business");
    expect(screen.getByText("0 coins")).toBeInTheDocument();
    expect(screen.getByText(/App Store 0%/)).toBeInTheDocument();
  });
});

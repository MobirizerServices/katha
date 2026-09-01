import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { Overview } from "../src/views/Overview";
import { renderWithStore, LocationDisplay } from "./helpers";
import { MOCK_OVERVIEW } from "../src/api/mock";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function renderOverview() {
  const view = renderWithStore(
    <>
      <Overview />
      <LocationDisplay />
    </>
  );
  await waitFor(() =>
    expect(screen.getByText(MOCK_OVERVIEW.kpis[0].value)).toBeInTheDocument());
  return view;
}

describe("Overview view", () => {
  it("greets with a real time-of-day and date, and reports refresh honestly", async () => {
    await renderOverview();
    expect(screen.getByText(/Good (morning|afternoon|evening), riya/)).toBeInTheDocument();
    expect(screen.getByText(/updated \d+s ago/)).toBeInTheDocument();
  });

  it("renders every KPI card from the data", async () => {
    await renderOverview();
    for (const k of MOCK_OVERVIEW.kpis) {
      expect(screen.getByText(k.label)).toBeInTheDocument();
    }
  });

  it("shows an honest all-clear when no attention items exist", async () => {
    await renderOverview();
    expect(screen.getByText(/Nothing needs a human right now/)).toBeInTheDocument();
  });

  it("renders live attention items as links when the server provides them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/attention")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [{ id: "approvals", severity: "warn",
            title: "2 approvals waiting", detail: "second person needed",
            to: "/approvals" }] }),
        });
      }
      return Promise.reject(new Error("offline"));
    }));
    await renderOverview();
    await waitFor(() =>
      expect(screen.getByText("2 approvals waiting")).toBeInTheDocument());
    fireEvent.click(screen.getByText("2 approvals waiting"));
    expect(screen.getByTestId("location").textContent).toBe("/approvals");
  });

  it("links KPI cards to their detail views (#008)", async () => {
    await renderOverview();
    const card = screen.getByText("Registered users").closest("a");
    expect(card).not.toBeNull();
    fireEvent.click(card!);
    expect(screen.getByTestId("location").textContent).toBe("/users");
  });
});

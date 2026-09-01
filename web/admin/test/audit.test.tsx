import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { Audit } from "../src/views/Audit";
import { renderWithStore, getStore } from "./helpers";
import { MOCK_AUDIT } from "../src/api/mock";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:test"),
    revokeObjectURL: vi.fn(),
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function renderAudit(route = "/audit") {
  const view = renderWithStore(<Audit />, { route });
  await waitFor(() =>
    expect(screen.getByText(MOCK_AUDIT[0].action)).toBeInTheDocument());
  return view;
}

describe("Audit view", () => {
  it("renders rows with the chain-verified badge", async () => {
    await renderAudit();
    expect(screen.getByText("chain verified")).toBeInTheDocument();
    expect(screen.getByText(/hash-chained and immutable/)).toBeInTheDocument();
  });

  it("filters by actor", async () => {
    await renderAudit();
    const someActor = MOCK_AUDIT[0].actor;
    fireEvent.change(screen.getByLabelText("Filter by actor"), { target: { value: someActor } });
    await waitFor(() => {
      const others = MOCK_AUDIT.filter((r) => r.actor !== someActor);
      if (others.length > 0) {
        expect(screen.queryByText(others[0].action)).toSatisfy(
          (el: HTMLElement | null) => el === null ||
            MOCK_AUDIT.some((r) => r.actor === someActor && r.action === others[0].action));
      }
      expect(screen.getAllByText(someActor).length).toBeGreaterThan(0);
    });
  });

  it("shows an empty state when nothing matches", async () => {
    await renderAudit();
    fireEvent.change(screen.getByLabelText("Filter by entity or action"),
                     { target: { value: "zzz-no-such-thing" } });
    await waitFor(() => expect(screen.getByText("No entries")).toBeInTheDocument());
  });

  it("exports a real CSV file, not a toast (#065)", async () => {
    await renderAudit();
    const clicks: string[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicks.push((this as HTMLAnchorElement).download);
    };
    try {
      fireEvent.click(screen.getByText(/Export CSV/));
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(clicks[0]).toMatch(/^katha-audit-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(getStore().toasts.at(-1)?.text).toMatch(/exported/);
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }
  });

  it("renders from→to changes as a diff (#072)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/audit")) {
        return Promise.resolve({ ok: true, json: async () => ({
          rows: [{ id: 9, ts: "2026-09-01T10:00:00+00:00", actor: "riya",
                   action: "config.flag.set", entity: "store.web_enabled",
                   change: "from=True, to=False", ip: "127.0.0.1" }],
          chain_ok: false, total: 1,
        }) });
      }
      return Promise.reject(new Error("offline"));
    }));
    renderWithStore(<Audit />);
    await waitFor(() => expect(screen.getByText("config.flag.set")).toBeInTheDocument());
    expect(screen.getByText("True")).toBeInTheDocument();
    expect(screen.getByText("False")).toBeInTheDocument();
    expect(screen.getByText(/CHAIN BROKEN/)).toBeInTheDocument();
  });
});

// Regression tests for the back-office UI audit (ADM-01…ADM-35): the fixes
// that changed behaviour rather than only CSS.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { Approvals } from "../src/views/Approvals";
import { Sidebar } from "../src/Sidebar";
import { paise } from "../src/views/Finance";
import { preview } from "../src/views/Outbox";
import { humanise } from "../src/views/CatalogDetail";
import { renderWithStore, getStore, stubFetch, LocationDisplay, SIGNALS } from "./helpers";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("ADM-25 — register amounts group like every other rupee figure", () => {
  it("formats paise with en-IN grouping", () => {
    expect(paise(199900)).toBe("₹1,999.00");
    expect(paise(8390)).toBe("₹83.90");
    expect(paise(0)).toBe("₹0.00");
    expect(paise(-9900)).toBe("-₹99.00");
  });
});

describe("ADM-27 — the outbox preview shows the message, not its source", () => {
  it("strips tags, scripts and entities", () => {
    expect(preview('<div style="x">Your Katha invoice</div>'))
      .toBe("Your Katha invoice");
    expect(preview("<script>alert(1)</script><p>hi</p>")).toBe("hi");
    expect(preview("a&nbsp;&amp;&lt;b&gt;")).toBe("a &<b>");
  });
});

describe("ADM-12 — server messages quoting ISO stamps are humanised", () => {
  it("rewrites the stamp and leaves the rest alone", () => {
    const out = humanise("already sent at 2026-09-04T16:44:44+00:00");
    expect(out.startsWith("already sent at ")).toBe(true);
    expect(out).not.toContain("2026-09-04T16:44:44");
    expect(humanise("no stamp here")).toBe("no stamp here");
    expect(humanise("bogus 9999-99-99T99:99:99Z")).toContain("9999-99-99T99:99:99Z");
  });
});

describe("ADM-03 — the inbox never shows a stale 'Inbox zero'", () => {
  it("re-reads the queue on mount, without waiting for a decision", async () => {
    const calls = stubFetch({
      // more specific needle first — SIGNALS carries a catch-all "/approvals"
      "/approvals?status=pending": () => [
        { id: "ap9", kind: "Coin adjustment", status: "pending",
          detail: "+900 · u1", requestedBy: "sam", when: "2026-09-01T00:00:00+00:00",
          needs: "Finance", amount: 900, userId: "u1" },
      ],
      ...SIGNALS,
    });
    renderWithStore(<Approvals />);
    await screen.findByText(/\+900 · u1/);
    expect(calls.filter((c) => c.url.includes("/approvals?status=pending")).length)
      .toBeGreaterThan(0);
  });

  it("a signal refresh brings the sidebar badge with it", async () => {
    stubFetch({
      "/approvals?status=pending": () => [
        { id: "ap8", kind: "Coin adjustment", status: "pending", detail: "+800 · u2",
          requestedBy: "sam", when: "2026-09-01T00:00:00+00:00", needs: "Finance",
          amount: 800, userId: "u2" },
      ],
      ...SIGNALS,
    });
    const { container } = renderWithStore(<Sidebar />);
    await waitFor(() => expect(getStore().approvals.length).toBe(1));
    act(() => getStore().refreshSignals());
    await waitFor(() =>
      expect(container.querySelector(".cnt.w")).toHaveTextContent("1"));
  });

  it("roles that cannot open the inbox never ask the server for it", async () => {
    const calls = stubFetch({ ...SIGNALS });
    renderWithStore(<Sidebar />);
    await waitFor(() => expect(getStore().online).toBe(true));
    act(() => getStore().setRole("qc"));         // qc has no approvals view
    const before = calls.filter((c) => c.url.includes("/approvals?")).length;
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    expect(calls.filter((c) => c.url.includes("/approvals?")).length).toBe(before);
  });
});

describe("ADM-28 — a signed-out load asks for nothing but identity", () => {
  it("fires no list reads until /auth/me answers with a session", async () => {
    const calls = stubFetch({
      "/auth/me": () => ({ mode: "oidc", authenticated: false, login: "/x" }),
    });
    renderWithStore(<div />);
    await waitFor(() => expect(getStore().signedOut).toBe(true));
    const reads = calls.map((c) => c.url).filter((u) => !u.includes("/auth/me"));
    expect(reads).toEqual([]);
  });
});

describe("ADM-16 — offline, the panel does not invent an operator", () => {
  it("says the operator is unknown instead of naming one", async () => {
    renderWithStore(<Sidebar />);
    await waitFor(() => expect(screen.getByText("Operator unknown")).toBeInTheDocument());
    expect(screen.queryByText("Riya Menon")).toBeNull();
    // the role preview is a client-side lens, so it stays available
    expect(screen.getByLabelText("Preview as role")).toBeInTheDocument();
  });
});

describe("ADM-35 — locked modules advertise no shortcut", () => {
  it("hides the chord hint on a view the role cannot open", async () => {
    const { container } = renderWithStore(<Sidebar />);
    await waitFor(() => expect(getStore().approvals.length).toBeGreaterThan(0));
    expect(screen.getByText("g c")).toBeInTheDocument();         // admin: catalog
    act(() => getStore().setRole("finance"));
    expect(screen.queryByText("g c")).toBeNull();                // finance: locked
    const locked = container.querySelectorAll(".navi.lock");
    expect(locked.length).toBeGreaterThan(0);
    for (const el of locked) expect(el.querySelector(".cnt")).toBeNull();
  });

  it("a chord for a locked view does not navigate", async () => {
    const { default: App } = await import("../src/App");
    stubFetch({ ...SIGNALS, "/access/matrix": () => null });
    renderWithStore(<><LocationDisplay /><App /></>, { route: "/access" });
    await waitFor(() => expect(getStore().online).toBe(true));
    act(() => getStore().setRole("finance"));
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "c" });                   // catalog: locked
    expect(screen.getByTestId("location")).toHaveTextContent("/access");
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "u" });                   // users: allowed
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/users"));
  });
});

describe("ADM-15 — identical toasts replace rather than stack", () => {
  it("keeps one copy of the same sentence", async () => {
    renderWithStore(<div />);
    act(() => {
      getStore().showToast("Same thing");
      getStore().showToast("Same thing");
      getStore().showToast("Same thing");
    });
    expect(getStore().toasts.filter((t) => t.text === "Same thing")).toHaveLength(1);
  });
});

describe("ADM-05 — expanded episodes are a sibling row, not a nested cell", () => {
  it("spans the whole table under its series", async () => {
    const { Media } = await import("../src/views/Media");
    stubFetch({
      ...SIGNALS,
      "/media/qc": () => ({ generated_at: "", series: [{
        slug: "s1", title: "S One", episodeCount: 1, episodes_with_media: 1,
        episodes_missing: 0, qc: { passed: 1, pending: 0, failed: 0 },
        episodes: [{ number: 1, title: "E1", hasMedia: true,
                     qc: { status: "passed", by: "ops", at: "2026-09-01T00:00:00+00:00",
                           note: "" } }],
      }] }),
    });
    const { container } = renderWithStore(<Media />);
    await screen.findByText("S One");
    fireEvent.click(screen.getByLabelText("Episodes of S One"));
    const eps = await waitFor(() => container.querySelector("tr.epsrow td")!);
    expect(eps.getAttribute("colspan")).toBe("6");
    expect(within(eps as HTMLElement).getByText("E1")).toBeInTheDocument();
  });
});

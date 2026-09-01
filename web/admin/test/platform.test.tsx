import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import App from "../src/App";
import { renderWithStore, getStore } from "./helpers";
import { mutate, send } from "../src/api/client";
import { CopyId, IsoTime, fmtINR } from "../src/ui";
import { render } from "@testing-library/react";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("offline banner (#005)", () => {
  it("appears when the server is unreachable", async () => {
    renderWithStore(<App />, { route: "/access" });
    await waitFor(() =>
      expect(screen.getByText(/Offline — showing sample data/)).toBeInTheDocument());
  });
});

describe("⌘K command palette (#086)", () => {
  it("opens from the topbar button, navigates by command, and closes on Escape", async () => {
    renderWithStore(<App />, { route: "/access" });
    await waitFor(() => expect(screen.getByText("Permission matrix")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Open command palette"));
    const input = await screen.findByPlaceholderText(/Jump to a user/);
    fireEvent.change(input, { target: { value: "audit" } });
    const cmd = await screen.findByText("Go to Audit log");
    fireEvent.click(cmd);
    await waitFor(() => expect(screen.getByText(/hash-chained and immutable/)).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const again = await screen.findByPlaceholderText(/Jump to a user/);
    fireEvent.keyDown(again, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Jump to a user/)).not.toBeInTheDocument());
  });

  it("keyboard: arrows + Enter run the selected command", async () => {
    renderWithStore(<App />, { route: "/access" });
    await waitFor(() => expect(screen.getByText("Permission matrix")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const input = await screen.findByPlaceholderText(/Jump to a user/);
    fireEvent.change(input, { target: { value: "overview" } });
    await screen.findByText("Go to Overview");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByText(/Good (morning|afternoon|evening)/)).toBeInTheDocument());
  });
});

describe("g-shortcuts (#087)", () => {
  it("g then u jumps to Users & wallet", async () => {
    renderWithStore(<App />, { route: "/access" });
    await waitFor(() => expect(screen.getByText("Permission matrix")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "u" });
    await waitFor(() => expect(screen.getByText("Users & wallet",
      { selector: "h1" })).toBeInTheDocument());
  });
});

describe("send()/mutate result contract", () => {
  it("offline mutations report { offline: true } — never fake success", async () => {
    const res = await mutate.adjust("u1", 10, "goodwill", "");
    expect(res).toEqual({ offline: true });
    const res2 = await mutate.grievanceResolve("G-1", "done");
    expect(res2).toEqual({ offline: true });
  });

  it("server refusals surface the detail as error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 409, json: async () => ({ detail: "already approved" }),
    }));
    const res = await send("/approvals/x/approve", "POST");
    expect(res).toMatchObject({ error: "already approved" });
  });

  it("malformed success bodies degrade to an empty object", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => { throw new Error("bad json"); },
    }));
    const res = await send("/x", "POST", { a: 1 });
    expect("offline" in res).toBe(false);
  });
});

describe("ui primitives", () => {
  it("fmtINR formats Indian rupees", () => {
    expect(fmtINR(199)).toBe("₹199");
    expect(fmtINR(0.15)).toBe("₹0.2");
  });

  it("IsoTime renders a dash for empty and a title for real stamps", () => {
    const { container, rerender } = render(<IsoTime iso="" />);
    expect(container.textContent).toBe("—");
    rerender(<IsoTime iso="2026-09-01T10:00:00+00:00" />);
    expect(container.querySelector("span")?.getAttribute("title"))
      .toBe("2026-09-01T10:00:00+00:00");
  });

  it("CopyId copies on click and confirms briefly", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: write } });
    render(<CopyId value="ctx_000000000042" />);
    fireEvent.click(screen.getByLabelText("Copy ctx_000000000042"));
    expect(write).toHaveBeenCalledWith("ctx_000000000042");
    await screen.findByText("copied");
  });
});

describe("view error boundary (#105)", () => {
  it("catches a crashing view and offers reload", async () => {
    // Palette command handler that throws — simplest reproducible crash path:
    // render App and force a boundary error by making a view throw via bad state.
    const Bomb = () => { throw new Error("boom"); };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ViewBoundary } = await import("../src/App");
    render(
      <ViewBoundary>
        <Bomb />
      </ViewBoundary>
    );
    expect(screen.getByText("This view hit an error")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Reload view"));
    spy.mockRestore();
  });
});

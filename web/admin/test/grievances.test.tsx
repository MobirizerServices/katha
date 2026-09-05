import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { Grievances } from "../src/views/Grievances";
import { renderWithStore, getStore } from "./helpers";

const G1 = {
  id: "G-AB12", user_id: "u1", contact: "a@b.c", channel: "app",
  subject: "double charge", body: "charged twice for E11",
  status: "new", assignee: "", created_at: "2026-08-30T00:00:00+00:00",
  ack_at: "", resolved_at: "", notes: [],
  age_hours: 50, ack_breach: true, resolve_breach: false,
};

function stubGrievanceServer(state: { rows: (typeof G1)[] }) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes("/grievances/") && u.includes("/ack")) {
      state.rows = state.rows.map((g) => ({ ...g, status: "ack", assignee: "riya" }));
      return Promise.resolve({ ok: true, json: async () => ({ id: "G-AB12", status: "ack" }) });
    }
    if (u.includes("/grievances/") && u.includes("/resolve")) {
      state.rows = state.rows.map((g) => ({ ...g, status: "resolved" }));
      return Promise.resolve({ ok: true, json: async () => ({ id: "G-AB12", status: "resolved" }) });
    }
    if (u.includes("/grievances")) {
      return Promise.resolve({ ok: true, json: async () => ({ grievances: state.rows }) });
    }
    if (u.includes("/health/full")) {
      return Promise.resolve({ ok: true, json: async () => ({ status: "ok", checks: {}, at: "" }) });
    }
    if (u.includes("/attention")) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    }
    // a signal refresh now also re-reads the approvals inbox (ADM-03)
    if (u.includes("/approvals?")) {
      return Promise.resolve({ ok: true, json: async () => [] });
    }
    return Promise.reject(new Error("offline"));
  }));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Grievances queue", () => {
  it("shows the empty state and the officer-of-record note offline", async () => {
    renderWithStore(<Grievances />);
    await waitFor(() => expect(screen.getByText("No grievances")).toBeInTheDocument());
    expect(screen.getByText(/named person before public beta/)).toBeInTheDocument();
  });

  it("renders SLA breaches loudly and acknowledges a ticket", async () => {
    const state = { rows: [{ ...G1 }] };
    stubGrievanceServer(state);
    renderWithStore(<Grievances />);
    await waitFor(() => expect(screen.getByText("G-AB12")).toBeInTheDocument());
    expect(screen.getByText("ACK OVERDUE")).toBeInTheDocument();
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    fireEvent.click(screen.getByText("Acknowledge"));
    await waitFor(() =>
      expect(getStore().toasts.at(-1)?.text).toMatch(/acknowledged/));
  });

  it("resolution demands a note (#073)", async () => {
    const state = { rows: [{ ...G1, status: "ack", ack_breach: false }] };
    stubGrievanceServer(state);
    renderWithStore(<Grievances />);
    await waitFor(() => expect(screen.getByText("G-AB12")).toBeInTheDocument());
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    fireEvent.click(screen.getByText("Resolve…"));
    const dialog = await screen.findByRole("dialog");
    const btn = within(dialog).getByText("Mark resolved");
    expect(btn).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Resolution note/),
                     { target: { value: "refunded duplicate order" } });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(getStore().toasts.at(-1)?.text).toMatch(/resolved/));
  });

  it("filters by status tab", async () => {
    const state = { rows: [{ ...G1 }] };
    stubGrievanceServer(state);
    renderWithStore(<Grievances />);
    await waitFor(() => expect(screen.getByText("G-AB12")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /Resolved/ }));
    expect(screen.getByText("Nothing resolved")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { Approvals } from "../src/views/Approvals";
import { renderWithStore, getStore } from "./helpers";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});


/** Go online via a resolving health check, and serve decide endpoints. */
function stubDecisions() {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes("/health/full")) {
      return Promise.resolve({ ok: true, json: async () =>
        ({ status: "ok", checks: {}, at: "now" }) });
    }
    if (u.includes("/approve") || u.includes("/reject")) {
      return Promise.resolve({ ok: true, json: async () => ({ status: "done" }) });
    }
    if (u.includes("/attention")) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    }
    if (u.includes("/approvals?status=pending")) {
      return Promise.resolve({ ok: true, json: async () => ([]) });
    }
    return Promise.reject(new Error("offline"));
  }));
}

async function renderApprovals() {
  const view = renderWithStore(<Approvals />);
  await waitFor(() => expect(getStore().approvals.length).toBeGreaterThan(0));
  return view;
}

describe("Approvals inbox", () => {
  it("lists pending items with SLA/age context", async () => {
    await renderApprovals();
    expect(screen.getAllByText("Coin adjustment").length).toBeGreaterThan(0);
    expect(screen.getByText(/second person/)).toBeInTheDocument();
  });

  it("finance (a second person) can approve — and it leaves the inbox", async () => {
    await renderApprovals();
    stubDecisions();
    act(() => getStore().setRole("finance"));
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    const target = getStore().approvals.find((a) => a.requestedBy !== "riya")!;
    const row = screen.getByText(target.detail).closest("li")!;
    fireEvent.click(within(row).getByText("Approve"));
    await waitFor(() =>
      expect(getStore().approvals.find((a) => a.id === target.id)).toBeUndefined());
    expect(getStore().toasts.at(-1)?.text).toMatch(/written to the ledger/);
  });

  it("a requester cannot self-approve: their approve button is disabled", async () => {
    await renderApprovals();
    stubDecisions();
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    act(() => getStore().addApproval({
      id: "apr_self", kind: "Coin adjustment", detail: "self · 900",
      requestedBy: "riya", when: "now", needs: "Finance", amount: 900, userId: "u9",
    }));
    const row = screen.getByText("self · 900").closest("li")!;
    expect(within(row).getByText("Approve")).toBeDisabled();
  });

  it("rejecting demands a note and returns the request with it", async () => {
    await renderApprovals();
    stubDecisions();
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    const target = getStore().approvals[0];
    const row = screen.getByText(target.detail).closest("li")!;
    fireEvent.click(within(row).getByText("Reject"));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByText("Reject with note");
    expect(confirm).toBeDisabled();                       // note required (#049)
    fireEvent.change(within(dialog).getByLabelText(/Note/),
                     { target: { value: "use the refund flow" } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(getStore().approvals.find((a) => a.id === target.id)).toBeUndefined());
    expect(getStore().toasts.at(-1)?.text).toMatch(/Rejected/);
  });

  it("roles without finance/admin cannot decide: actions are disabled", async () => {
    await renderApprovals();
    act(() => getStore().setRole("support"));
    const row = screen.getAllByText("Coin adjustment")[0].closest("li")!;
    expect(within(row).getByText("Approve")).toBeDisabled();
    expect(within(row).getByText("Reject")).toBeDisabled();
  });

  it("history tab fetches decided requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("status=all")) {
        return Promise.resolve({ ok: true, json: async () => ([{
          id: "apr_done", kind: "Coin adjustment", status: "rejected",
          detail: "-900 · old", requestedBy: "sam", when: "2026-09-01T00:00:00+00:00",
          needs: "Finance", amount: -900, userId: "u1", approvedBy: "farah",
        }]) });
      }
      return Promise.reject(new Error("offline"));
    }));
    renderWithStore(<Approvals />);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    await waitFor(() => expect(screen.getByText("-900 · old")).toBeInTheDocument());
    expect(screen.getByText(/decided by farah/)).toBeInTheDocument();
  });
});

describe("Approvals — bulk reject (#055)", () => {
  it("selects several and rejects them with one note", async () => {
    await renderApprovals();
    stubDecisions();
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByText(/Reject 2 with one note/));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Note/),
                     { target: { value: "wrong flow, use refunds" } });
    fireEvent.click(within(dialog).getByText("Reject with note"));
    await waitFor(() => expect(getStore().approvals.length).toBeLessThanOrEqual(1));
  });
});

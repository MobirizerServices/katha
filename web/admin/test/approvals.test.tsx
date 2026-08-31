import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { Approvals } from "../src/views/Approvals";
import { renderWithStore, getStore } from "./helpers";
import { ME } from "../src/store";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function renderApprovals() {
  const view = renderWithStore(<Approvals />);
  await waitFor(() => expect(screen.getAllByText(/requested by/).length).toBeGreaterThan(0));
  return view;
}

describe("Approvals inbox", () => {
  it("admin approving a request (not their own) resolves it and writes to the ledger", async () => {
    await renderApprovals();
    const before = getStore().approvals.length;
    const target = getStore().approvals[0]; // requestedBy: Farah Khan (not ME)
    const row = screen.getByText(target.detail).closest(".alert")!;
    fireEvent.click(within(row).getByRole("button", { name: "Approve" }));
    expect(getStore().approvals).toHaveLength(before - 1);
    expect(getStore().audit[0].action).toBe("approval.approve");
    expect(getStore().toast).toMatch(/Approved · change written/);
  });

  it("rejecting returns the request to the requester", async () => {
    await renderApprovals();
    const target = getStore().approvals[0];
    const row = screen.getByText(target.detail).closest(".alert")!;
    fireEvent.click(within(row).getByRole("button", { name: "Reject" }));
    expect(getStore().audit[0].action).toBe("approval.reject");
    expect(getStore().toast).toMatch(/Rejected · returned to requester/);
  });

  it("a requester cannot self-approve: their approve button is disabled with a warning", async () => {
    await renderApprovals();
    act(() =>
      getStore().addApproval({
        id: "apr_self",
        kind: "Coin adjustment",
        detail: "Credit 1,300 coins · usr_self",
        requestedBy: ME, // the signed-in admin requested this
        when: "Just now",
        needs: "Finance or Admin",
      })
    );
    const row = screen.getByText("Credit 1,300 coins · usr_self").closest(".alert")!;
    expect(within(row).getByText(/you can't approve it yourself/)).toBeInTheDocument();
    const approve = within(row).getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute("title", "Requester can't self-approve");
  });

  it("roles without finance/admin cannot decide: both actions are disabled", async () => {
    await renderApprovals();
    act(() => getStore().setRole("support")); // canAct(support,'finance') === false
    const target = getStore().approvals[0];
    const row = screen.getByText(target.detail).closest(".alert")!;
    expect(within(row).getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Reject" })).toBeDisabled();
  });

  it("finance (a second person) can decide", async () => {
    await renderApprovals();
    act(() => getStore().setRole("finance"));
    const target = getStore().approvals[0];
    const row = screen.getByText(target.detail).closest(".alert")!;
    expect(within(row).getByRole("button", { name: "Approve" })).not.toBeDisabled();
  });

  it("shows inbox-zero when everything is resolved", async () => {
    await renderApprovals();
    // resolve all current approvals
    act(() => {
      for (const a of [...getStore().approvals]) getStore().resolveApproval(a.id, "rejected", ME);
    });
    await waitFor(() => expect(screen.getByText("Inbox zero")).toBeInTheDocument());
  });
});

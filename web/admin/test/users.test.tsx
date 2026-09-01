import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { Users } from "../src/views/Users";
import { renderWithStore, getStore } from "./helpers";
import { api } from "../src/api/client";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function renderUsers() {
  const view = renderWithStore(<Users />);
  await waitFor(() => expect(screen.getByText("Meera K.")).toBeInTheDocument());
  return view;
}

describe("Users view — lookup + wallet", () => {
  it("selects the first user by default and shows the bonus-before-bought note", async () => {
    await renderUsers();
    expect(screen.getByText("Bonus coins are spent before bought coins. Coins never expire.")).toBeInTheDocument();
    // first user's bought balance
    expect(screen.getByText("1,200")).toBeInTheDocument();
  });

  it("filters the lookup list by query", async () => {
    await renderUsers();
    fireEvent.change(screen.getByPlaceholderText("Phone, user id, name or device…"), {
      target: { value: "arjun" },
    });
    expect(screen.getByText("Arjun R.")).toBeInTheDocument();
    expect(screen.queryByText("Meera K.")).not.toBeInTheDocument();
  });

  it("selecting a different user updates the wallet panel", async () => {
    await renderUsers();
    fireEvent.click(screen.getByText("Priya S."));
    // Priya's LTV
    expect(screen.getByText("₹420")).toBeInTheDocument();
  });

  it("masks PII for the finance role", async () => {
    await renderUsers();
    act(() => getStore().setRole("finance"));
    // lookup rows mask the phone, and the wallet panel masks it too
    expect(screen.getAllByText(/•••• masked/).length).toBeGreaterThan(1);
    expect(screen.getByText("•••• masked (finance)")).toBeInTheDocument();
  });

  it("shows the empty wallet state when there are no users", async () => {
    vi.spyOn(api, "listUsers").mockResolvedValue([]);
    renderWithStore(<Users />);
    await waitFor(() => expect(screen.getByText("Select a user")).toBeInTheDocument());
  });
});

describe("Users view — coin adjustment dialog (dual control)", () => {
  it("writes a ledger entry directly for adjustments at or below 500", async () => {
    await renderUsers();
    fireEvent.click(screen.getByRole("button", { name: "Adjust coins…" }));
    const dialog = screen.getByRole("dialog");
    // default amount is 100 (<= 500) => "Write ledger entry"
    const submit = within(dialog).getByRole("button", { name: "Write ledger entry" });
    fireEvent.click(submit);
    expect(getStore().audit[0]).toMatchObject({ action: "wallet.adjust" });
    expect(getStore().toast).toMatch(/Ledger entry written/);
  });

  it("routes adjustments above 500 to the approvals inbox with nothing written", async () => {
    await renderUsers();
    const approvalsBefore = getStore().approvals.length;
    const auditBefore = getStore().audit.length;
    fireEvent.click(screen.getByRole("button", { name: "Adjust coins…" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "600" } });
    const submit = within(dialog).getByRole("button", { name: "Request approval" });
    fireEvent.click(submit);
    expect(getStore().approvals).toHaveLength(approvalsBefore + 1);
    expect(getStore().approvals[0]).toMatchObject({ kind: "Coin adjustment", requestedBy: "Riya Menon" });
    // above-500 writes NOTHING to the ledger
    expect(getStore().audit).toHaveLength(auditBefore);
    expect(getStore().toast).toMatch(/Approval requested/);
  });

  it("records a Debit as a negative amount on the approval", async () => {
    await renderUsers();
    fireEvent.click(screen.getByRole("button", { name: "Adjust coins…" }));
    const dialog = screen.getByRole("dialog");
    // direction select is the first combobox in the dialog
    const selects = within(dialog).getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "Debit" } });
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Request approval" }));
    expect(getStore().approvals[0].amount).toBe(-700);
  });

  it("clamps a negative typed amount to zero", async () => {
    await renderUsers();
    fireEvent.click(screen.getByRole("button", { name: "Adjust coins…" }));
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "-50" } });
    expect(input.value).toBe("0");
  });

  it("accepts an audit note for a small adjustment", async () => {
    await renderUsers();
    fireEvent.click(screen.getByRole("button", { name: "Adjust coins…" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("What did you verify?"), {
      target: { value: "checked App Store receipt" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Write ledger entry" }));
    expect(getStore().audit[0].change).toContain("checked App Store receipt");
  });

  it("blocks non support/finance roles with a warning and a disabled submit", async () => {
    await renderUsers();
    act(() => getStore().setRole("analyst"));
    fireEvent.click(screen.getByRole("button", { name: "Adjust coins…" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/cannot make money adjustments/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Write ledger entry" })).toBeDisabled();
  });

  it("closes on Cancel", async () => {
    await renderUsers();
    fireEvent.click(screen.getByRole("button", { name: "Adjust coins…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Users view — ledger dialog", () => {
  it("opens the ledger, shows live rows when the server answers, and closes", async () => {
    // First render uses the rejecting fetch stub (mock users), then the ledger
    // fetch resolves with two rows.
    await renderUsers();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        user_id: "u1",
        wallet: { balance_bought: 570, balance_bonus: 0, total: 570 },
        transactions: [
          { id: "ctx_1", type: "purchase", amount_bought: 600, amount_bonus: 0,
            reference_type: "iap", reference_id: "coins_starter_in", created_at: "t1" },
          { id: "ctx_2", type: "unlock", amount_bought: -30, amount_bonus: 0,
            reference_type: "episode", reference_id: "kaanch-ka-mahal:e11", created_at: "t2" },
        ],
      }),
    } as unknown as Response);

    fireEvent.click(screen.getByText("View ledger"));
    await waitFor(() => expect(screen.getByText("coins_starter_in")).toBeInTheDocument());
    expect(screen.getByText("+600")).toBeInTheDocument();
    expect(screen.getByText("-30")).toBeInTheDocument();
    expect(screen.getByText("kaanch-ka-mahal:e11")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Close"));
    await waitFor(() =>
      expect(screen.queryByText("coins_starter_in")).not.toBeInTheDocument());
  });

  it("shows the empty state when the server is absent", async () => {
    await renderUsers();
    fireEvent.click(screen.getByText("View ledger"));
    await waitFor(() =>
      expect(screen.getByText("No ledger entries for this user yet.")).toBeInTheDocument());
  });
});

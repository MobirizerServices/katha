import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { Audit } from "../src/views/Audit";
import { renderWithStore, getStore } from "./helpers";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function renderAudit() {
  const view = renderWithStore(<Audit />);
  await waitFor(() => expect(screen.getByText("episode.publish")).toBeInTheDocument());
  return view;
}

describe("Audit view", () => {
  it("lists audit rows and the CSV export count", async () => {
    await renderAudit();
    expect(screen.getByText(/Export CSV \(\d+\)/)).toBeInTheDocument();
    expect(screen.getByText("wallet.rebuild")).toBeInTheDocument();
  });

  it("filters by actor", async () => {
    await renderAudit();
    fireEvent.change(screen.getByPlaceholderText("Actor…"), { target: { value: "farah" } });
    expect(screen.getByText("wallet.adjust")).toBeInTheDocument();
    expect(screen.queryByText("episode.publish")).not.toBeInTheDocument();
  });

  it("filters by entity or action and shows an empty state when nothing matches", async () => {
    await renderAudit();
    fireEvent.change(screen.getByPlaceholderText("Entity or action…"), {
      target: { value: "finance.import" },
    });
    expect(screen.getByText("Apple payout Aug 2026")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Entity or action…"), {
      target: { value: "no-such-entity-xyz" },
    });
    expect(screen.getByText("No entries")).toBeInTheDocument();
  });

  it("export toast reports the filtered row count", async () => {
    await renderAudit();
    fireEvent.click(screen.getByText(/Export CSV/));
    await waitFor(() => expect(getStore().toast).toMatch(/Audit log exported · \d+ rows/));
  });
});

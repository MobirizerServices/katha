import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { Components } from "../src/views/Components";
import { renderWithStore, getStore } from "./helpers";
import { ALL_NAV_ITEMS } from "../src/nav";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Components — the design system page", () => {
  it("is marked internal and shows tokens, statuses and every g-shortcut", () => {
    renderWithStore(<Components />);
    expect(screen.getByText("Internal · admin only")).toBeInTheDocument();
    expect(screen.getByText("--accent")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    for (const n of ALL_NAV_ITEMS.filter((n) => n.kb)) {
      expect(screen.getByText(n.kb!)).toBeInTheDocument();
    }
    expect(screen.getAllByText("⌘K").length).toBeGreaterThan(0);
  });

  it("live pieces respond: chip, toggle, modal, toasts", async () => {
    renderWithStore(<Components />);
    fireEvent.click(screen.getByText("Filter"));
    expect(screen.getByText("Selected")).toBeInTheDocument();
    const tog = screen.getByLabelText("Demo toggle");
    expect(tog).toHaveAttribute("aria-checked", "true");
    fireEvent.click(tog);
    expect(tog).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByText("Open a modal"));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByText("Confirm"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Open a modal"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByText("Cancel"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Open a modal"));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Toast"));
    fireEvent.click(screen.getByText("Error toast"));
    await waitFor(() => expect(getStore().toasts.map((t) => t.kind)).toEqual(["info", "error"]));
  });
});

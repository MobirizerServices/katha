import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { Sidebar } from "../src/Sidebar";
import { renderWithStore, getStore } from "./helpers";
import { MOCK_APPROVALS } from "../src/api/mock";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Sidebar", () => {
  it("renders the brand and every nav label with links for the admin role", async () => {
    const { container } = renderWithStore(<Sidebar />);
    expect(screen.getByText("Katha Admin")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Roles & access")).toBeInTheDocument();
    // admin can view everything -> no locked items
    await waitFor(() => expect(getStore().approvals.length).toBe(MOCK_APPROVALS.length));
    expect(container.querySelectorAll(".navi.lock")).toHaveLength(0);
  });

  it("shows the approvals count badge once approvals load", async () => {
    const { container } = renderWithStore(<Sidebar />);
    await waitFor(() =>
      expect(container.querySelector(".cnt.w")).toHaveTextContent(String(MOCK_APPROVALS.length))
    );
  });

  it("shows a keyboard hint on an item with no count", () => {
    renderWithStore(<Sidebar />);
    expect(screen.getByText("g o")).toBeInTheDocument(); // Overview hint
  });

  it("locks views the current role cannot open", async () => {
    const { container } = renderWithStore(<Sidebar />);
    await waitFor(() => expect(getStore().approvals.length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Preview as role"), { target: { value: "qc" } });
    // qc cannot open users / approvals / config -> locked entries appear
    const locked = container.querySelectorAll(".navi.lock");
    expect(locked.length).toBeGreaterThan(0);
    expect(getStore().role).toBe("qc");
  });

  it("changing the preview role updates the store", () => {
    renderWithStore(<Sidebar />);
    fireEvent.change(screen.getByLabelText("Preview as role"), { target: { value: "support" } });
    expect(getStore().role).toBe("support");
    expect(getStore().toast).toBe("Previewing as Support");
  });
});

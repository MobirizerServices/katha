import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { Overview } from "../src/views/Overview";
import { LocationDisplay, renderWithStore } from "./helpers";
import { api } from "../src/api/client";
import { MOCK_APPROVALS } from "../src/api/mock";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Overview view", () => {
  it("shows a loading skeleton before data arrives", () => {
    renderWithStore(<Overview />);
    expect(screen.getByText("Loading dashboard…")).toBeInTheDocument();
  });

  it("renders KPIs, pipeline and the up/down delta emphasis", async () => {
    const { container } = renderWithStore(<Overview />);
    await waitFor(() => expect(screen.getByText("Daily active users")).toBeInTheDocument());
    expect(screen.getByText("118,420")).toBeInTheDocument();
    // delta with an up direction gets an ".up" span; down gets ".down"
    expect(container.querySelector(".dl .up")).toBeTruthy();
    expect(container.querySelector(".dl .down")).toBeTruthy();
    // pipeline stage present
    expect(screen.getByText("Human QC & rating")).toBeInTheDocument();
  });

  it("fills the 'Approvals waiting' alert with the live approval kinds", async () => {
    renderWithStore(<Overview />);
    await waitFor(() => expect(screen.getByText("Approvals waiting")).toBeInTheDocument());
    const kinds = MOCK_APPROVALS.map((a) => a.kind).join(" · ");
    expect(screen.getByText(kinds)).toBeInTheDocument();
  });

  it("shows 'Inbox zero' when there are no approvals", async () => {
    vi.spyOn(api, "listApprovals").mockResolvedValue([]);
    renderWithStore(<Overview />);
    await waitFor(() => expect(screen.getByText("Approvals waiting")).toBeInTheDocument());
    expect(screen.getByText("Inbox zero")).toBeInTheDocument();
  });

  it("navigates when an attention item is clicked", async () => {
    renderWithStore(
      <>
        <Overview />
        <LocationDisplay />
      </>
    );
    await waitFor(() => expect(screen.getByText("Approvals waiting")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Approvals waiting"));
    expect(screen.getByTestId("location")).toHaveTextContent("/approvals");
  });
});

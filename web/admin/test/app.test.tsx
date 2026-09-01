import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import App from "../src/App";
import { renderWithStore, getStore } from "./helpers";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("App routing + guards", () => {
  it("redirects '/' to the overview view", async () => {
    renderWithStore(<App />, { route: "/" });
    await waitFor(() =>
      expect(screen.getByText(/Good (morning|afternoon|evening), riya/)).toBeInTheDocument());
    // topbar chrome reports the real (unreachable) server state — never a fake green
    expect(screen.getByText("Server unreachable")).toBeInTheDocument();
  });

  it("redirects an unknown path to overview", async () => {
    renderWithStore(<App />, { route: "/nope/nope" });
    await waitFor(() =>
      expect(screen.getByText(/Good (morning|afternoon|evening), riya/)).toBeInTheDocument());
  });

  it("renders an allowed view (access) for admin", async () => {
    renderWithStore(<App />, { route: "/access" });
    await waitFor(() => expect(screen.getByText("Permission matrix")).toBeInTheDocument());
  });

  it("denies a view the current role cannot open", async () => {
    renderWithStore(<App />, { route: "/catalog" });
    // admin can see catalog first
    await waitFor(() => expect(getStore().approvals.length).toBeGreaterThan(0));
    act(() => getStore().setRole("analyst")); // analyst cannot open catalog
    await waitFor(() =>
      expect(screen.getByText(/can't open Catalog/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Back to overview" })).toBeInTheDocument();
  });

  it("renders a toast when the preview role changes", async () => {
    renderWithStore(<App />, { route: "/access" });
    act(() => getStore().setRole("finance"));
    await waitFor(() => expect(screen.getByText(/Previewing as Finance/)).toBeInTheDocument());
  });
});

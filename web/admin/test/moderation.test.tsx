import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { Moderation } from "../src/views/Moderation";
import { renderWithStore, getStore, stubFetch, SIGNALS, goOnline, LocationDisplay } from "./helpers";

const QUEUE = {
  open: 2,
  items: [
    { id: "rating:kaanch-ka-mahal", kind: "rating", slug: "kaanch-ka-mahal",
      title: "Kaanch Ka Mahal", rating: "U/A 16+", by: "dev", detail: "episode 41",
      at: "2026-09-01T00:00:00+00:00", to: "/catalog/kaanch-ka-mahal" },
    { id: "grievance:G-1", kind: "grievance", gid: "G-1", title: "Vulgar scene",
      detail: "not for minors", status: "new", channel: "app",
      at: "2026-08-30T00:00:00+00:00", to: "/grievances" },
    { id: "grievance:G-0", kind: "grievance", gid: "G-0", title: "Rating too low",
      detail: "", status: "resolved", channel: "web",
      at: "2026-08-01T00:00:00+00:00", to: "/grievances",
      reviewed: { by: "riya", at: "t", note: "checked" } },
    { id: "rating:old", kind: "rating", slug: "old", title: "Old", rating: "U",
      by: "", detail: "", at: "2026-08-02T00:00:00+00:00", to: "/catalog/old",
      reviewed: { by: "riya", at: "t", note: "" } },
  ],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Moderation & ratings", () => {
  it("offline: empty queue in both tabs", async () => {
    renderWithStore(<Moderation />);
    await screen.findByText("Nothing to review");
    fireEvent.click(screen.getByRole("tab", { name: "Reviewed" }));
    expect(screen.getByText("Nothing reviewed yet")).toBeInTheDocument();
  });

  it("lists open items, reviewed items on their tab, and links out", async () => {
    stubFetch({ ...SIGNALS, "/moderation": () => QUEUE });
    renderWithStore(<><Moderation /><LocationDisplay /></>);
    await screen.findByText("Kaanch Ka Mahal");
    expect(screen.getByText("2 open")).toBeInTheDocument();
    expect(screen.getByText("Vulgar scene")).toBeInTheDocument();
    expect(screen.queryByText("Rating too low")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Reviewed" }));
    expect(screen.getByText("Rating too low")).toBeInTheDocument();
    expect(screen.getByText(/reviewed by riya — checked/)).toBeInTheDocument();
    expect(screen.getByText("Old")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("open")[0]);
    expect(screen.getByTestId("location").textContent).toBe("/grievances");
  });

  it("marks an item reviewed with a note and confirms a rating with a reason", async () => {
    const calls = stubFetch({
      "/moderation/grievance%3AG-1/reviewed": () => ({ id: "grievance:G-1",
        reviewed: { by: "riya", at: "t", note: "watched" } }),
      "/catalog/series/kaanch-ka-mahal/rating": () => ({ slug: "kaanch-ka-mahal",
        rating: { value: "A" } }),
      ...SIGNALS, "/moderation": () => QUEUE,
    });
    renderWithStore(<Moderation />);
    await screen.findByText("Kaanch Ka Mahal");
    await goOnline();
    fireEvent.click(screen.getAllByText("Mark reviewed…")[1]);
    let dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Review note"), { target: { value: "watched" } });
    fireEvent.click(within(dlg).getByText("Mark reviewed"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text.includes("Vulgar scene reviewed"))).toBe(true));
    const post = calls.find((c) => c.url.includes("/reviewed"));
    expect(post?.init?.method).toBe("POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ note: "watched" });

    fireEvent.click(screen.getByText("Confirm rating…"));
    dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("Save rating")).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("Rating"), { target: { value: "A" } });
    fireEvent.change(within(dlg).getByLabelText("Rating reason"), { target: { value: "E41" } });
    fireEvent.click(within(dlg).getByText("Save rating"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text.includes("Rated A"))).toBe(true));
    const patch = calls.find((c) => c.url.includes("/rating"));
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ rating: "A", reason: "E41" });
  });

  it("an offline review is reported, not assumed", async () => {
    stubFetch({ ...SIGNALS, "/moderation": () => QUEUE });
    renderWithStore(<Moderation />);
    await screen.findByText("Kaanch Ka Mahal");
    await goOnline();
    fireEvent.click(screen.getAllByText("Mark reviewed…")[0]);
    const dlg = await screen.findByRole("dialog");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    fireEvent.click(within(dlg).getByText("Mark reviewed"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Offline — not marked")).toBe(true));
  });

  it("surfaces refusals and offline for both actions; modals cancel", async () => {
    stubFetch({
      "/reviewed": () => ({ __status: 409, detail: "already reviewed by dev" }),
      "/rating": () => ({ __status: 400, detail: "bad rating" }),
      ...SIGNALS, "/moderation": () => QUEUE,
    });
    renderWithStore(<Moderation />);
    await screen.findByText("Kaanch Ka Mahal");
    await goOnline();
    fireEvent.click(screen.getAllByText("Mark reviewed…")[0]);
    fireEvent.click(within(await screen.findByRole("dialog")).getByText("Mark reviewed"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Not marked: already reviewed by dev")).toBe(true));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Cancel"));
    fireEvent.click(screen.getAllByText("Mark reviewed…")[0]);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Confirm rating…"));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Confirm rating…"));
    let dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Rating reason"), { target: { value: "why" } });
    fireEvent.click(within(dlg).getByText("Save rating"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Rating not changed: bad rating")).toBe(true));
    fireEvent.click(within(dlg).getByText("Cancel"));

    // the server vanishes with the rating modal open: the click reports offline
    fireEvent.click(screen.getByText("Confirm rating…"));
    dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Rating reason"), { target: { value: "why" } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    fireEvent.click(within(dlg).getByText("Save rating"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Offline — rating unchanged")).toBe(true));
    fireEvent.click(within(dlg).getByText("Cancel"));
    // once offline is known, the actions are disabled
    expect(screen.getAllByText("Mark reviewed…")[0]).toBeDisabled();
  });
});

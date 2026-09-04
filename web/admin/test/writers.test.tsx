import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Writers, draftOutline, MAX_ITEMS } from "../src/views/Writers";
import { renderWithStore, getStore, stubFetch, SIGNALS, goOnline } from "./helpers";

const INDEX = { series: [
  { slug: "kaanch-ka-mahal", title: "Kaanch Ka Mahal", episodeCount: 3, completeness_pct: 75,
    hooks: 1, outlines: 2, by: "nikhil", updated_at: "2026-09-01T00:00:00+00:00" },
  { slug: "ceo-sahab", title: "CEO Sahab", episodeCount: 72, completeness_pct: 25,
    hooks: 0, outlines: 0, by: "", updated_at: "" },
  { slug: "empty", title: "Empty", episodeCount: 10, completeness_pct: 0,
    hooks: 0, outlines: 0, by: "", updated_at: "" },
] };

const WS = {
  slug: "kaanch-ka-mahal", title: "Kaanch Ka Mahal", episodeCount: 3, completeness_pct: 75,
  logline: "A glass palace hides a murder.", hooks: ["Who broke the mirror?"],
  episode_outlines: [{ number: 1, beat: "Meera arrives" }, { number: 2, beat: "" }],
  notes: "", by: "nikhil", updated_at: "2026-09-01T00:00:00+00:00",
};
const WS2 = { ...WS, slug: "ceo-sahab", title: "CEO Sahab", episodeCount: 72,
              completeness_pct: 25, logline: "x", hooks: [], episode_outlines: [], by: "" };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("draftOutline (local template, no model)", () => {
  it("keeps existing beats, labels pilot/acts/finale, caps at MAX_ITEMS", () => {
    const out = draftOutline(5, [{ number: 2, beat: "mine" }]);
    expect(out).toHaveLength(5);
    expect(out[0].beat.startsWith("Pilot:")).toBe(true);
    expect(out[1].beat).toBe("mine");
    expect(out[2].beat.startsWith("Act 2:")).toBe(true);
    expect(out[4].beat.startsWith("Finale:")).toBe(true);
    expect(draftOutline(500, [])).toHaveLength(MAX_ITEMS);
  });
});

describe("AI Writers' Room", () => {
  it("offline: no workspaces and a prompt to pick a series", async () => {
    renderWithStore(<Writers />);
    await screen.findByText("No series");
    expect(screen.getByText("Pick a series")).toBeInTheDocument();
  });

  it("lists completeness, opens a workspace, drafts, edits and saves it", async () => {
    let saved: Record<string, unknown> | null = null;
    const calls = stubFetch({
      "/writers/kaanch-ka-mahal": (init) => {
        if (init?.method === "PUT") {
          saved = JSON.parse(String(init.body));
          return { ...WS, ...saved, completeness_pct: 100, by: "riya" };
        }
        return WS;
      },
      "/writers/ceo-sahab": () => WS2,
      "/writers/empty": () => ({ __status: 404, detail: "series not found" }),
      ...SIGNALS, "/writers": () => INDEX,
    });
    renderWithStore(<Writers />);
    await screen.findByText("Kaanch Ka Mahal");
    await goOnline();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("Open")[0]);
    await screen.findByText(/last saved by nikhil/);
    expect(screen.getByLabelText("Logline")).toHaveValue("A glass palace hides a murder.");
    expect(screen.getByLabelText("Hooks")).toHaveValue("Who broke the mirror?");
    expect(screen.getByLabelText("Beat 1")).toHaveValue("Meera arrives");

    fireEvent.click(screen.getByText("Draft outline (local template)"));
    expect(screen.getByLabelText("Beat 1")).toHaveValue("Meera arrives");   // kept
    expect((screen.getByLabelText("Beat 3") as HTMLInputElement).value).toMatch(/^Finale:/);
    expect(screen.getByText("Add beat")).toBeDisabled();                    // 3/3
    fireEvent.click(screen.getByLabelText("Remove beat 3"));
    expect(screen.queryByLabelText("Beat 3")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Add beat"));
    fireEvent.change(screen.getByLabelText("Beat 3"), { target: { value: "The cliff" } });
    fireEvent.change(screen.getByLabelText("Logline"), { target: { value: " New logline " } });
    fireEvent.change(screen.getByLabelText("Hooks"), { target: { value: "one\n\n two " } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "n" } });
    fireEvent.click(screen.getByText("Save workspace"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text.includes("100% complete"))).toBe(true));
    expect(saved).toEqual({
      logline: "New logline", hooks: ["one", "two"], notes: "n",
      episode_outlines: [{ number: 1, beat: "Meera arrives" },
                         { number: 2, beat: expect.stringMatching(/^Act/) },
                         { number: 3, beat: "The cliff" }],
    });
    await screen.findByText(/last saved by riya/);          // the server's answer
    expect(calls.filter((c) => c.url.endsWith("/writers")).length).toBeGreaterThan(1);

    // a workspace without a saver, then one the server does not know
    fireEvent.click(screen.getAllByText("Open")[1]);
    await screen.findByText("CEO Sahab", { selector: "h3" });
    expect(screen.queryByText(/last saved by/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Open")[2]);
    await screen.findByText("Workspace unavailable");
  });

  it("reports a refused save and an offline save", async () => {
    stubFetch({
      "/writers/kaanch-ka-mahal": (init) => init?.method === "PUT"
        ? { __status: 400, detail: "hooks: a list of at most 200" } : WS,
      ...SIGNALS, "/writers": () => INDEX,
    });
    renderWithStore(<Writers />);
    await screen.findByText("Kaanch Ka Mahal");
    await goOnline();
    fireEvent.click(screen.getAllByText("Open")[0]);
    await screen.findByText("Save workspace");
    fireEvent.click(screen.getByText("Save workspace"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Not saved: hooks: a list of at most 200")).toBe(true));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    fireEvent.click(screen.getByText("Save workspace"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Offline — workspace not saved")).toBe(true));
  });
});

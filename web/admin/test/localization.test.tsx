import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { Localization } from "../src/views/Localization";
import { renderWithStore, getStore, stubFetch, SIGNALS, goOnline } from "./helpers";

const cell = (status: string, owner = "", due = "") =>
  ({ status, owner, due, by: owner ? "nikhil" : "", at: owner ? "t" : "" });

const BOARD = {
  languages: ["hi", "ta", "te"], kinds: ["dub", "sub"],
  series: [{
    slug: "kaanch-ka-mahal", title: "Kaanch Ka Mahal", primary: "hi", language: "Hindi",
    langs: {
      hi: { dub: cell("done", "Studio A", "2026-10-01"), sub: cell("done", "Studio A") },
      ta: { dub: cell("in_progress", "Priya"), sub: cell("none") },
      te: { dub: cell("none"), sub: cell("none") },
    },
  }],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Localization matrix", () => {
  it("offline: no series to show", async () => {
    renderWithStore(<Localization />);
    await screen.findByText("No series yet");
  });

  it("renders the series × language grid with status chips", async () => {
    stubFetch({ ...SIGNALS, "/localization": () => BOARD });
    renderWithStore(<Localization />);
    await screen.findByText("Kaanch Ka Mahal");
    expect(screen.getByRole("columnheader", { name: "Tamil" })).toBeInTheDocument();
    const ta = screen.getByLabelText("Kaanch Ka Mahal Tamil dub");
    expect(ta).toHaveTextContent("dub in progress");
    expect(ta).toHaveAttribute("title", "Priya");
    expect(screen.getByLabelText("Kaanch Ka Mahal Hindi dub"))
      .toHaveAttribute("title", "Studio A · due 2026-10-01");
    expect(screen.getByLabelText("Kaanch Ka Mahal Telugu sub"))
      .toHaveAttribute("title", "unassigned");
  });

  it("edits a cell through the modal and reconciles with the server", async () => {
    const calls = stubFetch({
      "/localization/kaanch-ka-mahal": () => ({ slug: "kaanch-ka-mahal", lang: "ta", kind: "sub",
                                                status: "in_progress", langs: BOARD.series[0].langs }),
      ...SIGNALS, "/localization": () => BOARD,
    });
    renderWithStore(<Localization />);
    await screen.findByText("Kaanch Ka Mahal");
    await goOnline();
    fireEvent.click(screen.getByLabelText("Kaanch Ka Mahal Tamil sub"));
    const dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Status"), { target: { value: "in_progress" } });
    fireEvent.change(within(dlg).getByLabelText("Owner"), { target: { value: " Sai " } });
    fireEvent.change(within(dlg).getByLabelText("Due"), { target: { value: "2026-11-01" } });
    fireEvent.click(within(dlg).getByText("Save"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text.includes("Tamil sub → in_progress"))).toBe(true));
    const patch = calls.find((c) => c.url.includes("/localization/kaanch-ka-mahal"));
    expect(patch?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      lang: "ta", kind: "sub", status: "in_progress", owner: "Sai", due: "2026-11-01" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("refusal and offline are reported, cancel closes; non-content roles cannot edit", async () => {
    stubFetch({
      "/localization/kaanch-ka-mahal": () => ({ __status: 400, detail: "due must be YYYY-MM-DD" }),
      ...SIGNALS, "/localization": () => BOARD,
    });
    renderWithStore(<Localization />);
    await screen.findByText("Kaanch Ka Mahal");
    await goOnline();
    fireEvent.click(screen.getByLabelText("Kaanch Ka Mahal Telugu dub"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByText("Save"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Not saved: due must be YYYY-MM-DD")).toBe(true));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Cancel"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Kaanch Ka Mahal Telugu dub"));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // the server vanishes with the modal open
    fireEvent.click(screen.getByLabelText("Kaanch Ka Mahal Telugu dub"));
    await screen.findByRole("dialog");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Save"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Offline — nothing saved")).toBe(true));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Cancel"));
    act(() => getStore().setRole("qc"));
    expect(screen.getByLabelText("Kaanch Ka Mahal Telugu dub")).toBeDisabled();
  });
});

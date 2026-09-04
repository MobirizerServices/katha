import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { Media } from "../src/views/Media";
import { renderWithStore, getStore, stubFetch, SIGNALS, goOnline } from "./helpers";

const BOARD = {
  generated_at: "2026-09-01T00:00:00+00:00",
  series: [
    { slug: "alpha", title: "Alpha", episodeCount: 2, episodes_with_media: 1,
      episodes_missing: 1, qc: { pending: 1, passed: 0, failed: 1 },
      episodes: [
        { number: 1, title: "One", hasMedia: true,
          qc: { status: "failed", note: "audio drops", by: "dev",
                at: "2026-09-01T00:00:00+00:00" } },
        { number: 2, title: "Two", hasMedia: false,
          qc: { status: "pending", note: "", by: "", at: "" } }] },
    { slug: "beta", title: "Beta", episodeCount: 1, episodes_with_media: 1,
      episodes_missing: 0, qc: { pending: 0, passed: 1, failed: 0 },
      episodes: [
        { number: 1, title: "Uno", hasMedia: true,
          qc: { status: "passed", note: "", by: "dev",
                at: "2026-09-01T00:00:00+00:00" } }] },
  ],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Media & QC", () => {
  it("offline shows an honest empty board, never sample verdicts", async () => {
    renderWithStore(<Media />);
    await screen.findByText("Nothing to fix");
  });

  it("lists series with media gaps and QC counts; filters narrow the board", async () => {
    stubFetch({ ...SIGNALS, "/media/qc": () => BOARD });
    renderWithStore(<Media />);
    await screen.findByText("Alpha");
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Missing media"));
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Failed QC"));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("All"));
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("expands episodes (filtered too) and records pass / fail verdicts", async () => {
    const calls = stubFetch({
      "/media/qc/alpha/2": () => ({ slug: "alpha", number: 2,
                                    qc: { status: "passed", note: "", by: "riya", at: "t" } }),
      "/media/qc/alpha/1": () => ({ slug: "alpha", number: 1,
                                    qc: { status: "failed", note: "black frames", by: "riya", at: "t" } }),
      ...SIGNALS, "/media/qc": () => BOARD,
    });
    renderWithStore(<Media />);
    await screen.findByText("Alpha");
    await goOnline();
    fireEvent.click(screen.getByLabelText("Episodes of Alpha"));
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText(/audio drops/)).toBeInTheDocument();
    // the missing filter also narrows the expanded episode list
    fireEvent.click(screen.getByText("Missing media"));
    expect(screen.queryByText("One")).not.toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Pass E2"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text.includes("E2 passed"))).toBe(true));
    const patch = calls.find((c) => c.url.includes("/media/qc/alpha/2"));
    expect(patch?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ status: "passed", note: "" });

    fireEvent.click(screen.getByText("All"));
    fireEvent.click(screen.getByLabelText("Fail E1"));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("Record failure")).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("QC note"), { target: { value: "black frames" } });
    fireEvent.click(within(dlg).getByText("Record failure"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text.includes("E1 failed"))).toBe(true));
    const fail = calls.find((c) => c.url.includes("/media/qc/alpha/1"));
    expect(JSON.parse(String(fail?.init?.body))).toEqual({ status: "failed", note: "black frames" });
    // Beta's passed verdict renders with its reviewer and no note
    fireEvent.click(screen.getByLabelText("Episodes of Beta"));
    expect(screen.getByText("Uno")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Hide"));
    expect(screen.queryByText("Uno")).not.toBeInTheDocument();
  });

  it("reports a refused verdict and an offline verdict honestly", async () => {
    stubFetch({
      "/media/qc/alpha/2": () => ({ __status: 400, detail: "no such episode" }),
      ...SIGNALS, "/media/qc": () => BOARD,
    });
    renderWithStore(<Media />);
    await screen.findByText("Alpha");
    await goOnline();
    fireEvent.click(screen.getByLabelText("Episodes of Alpha"));
    fireEvent.click(screen.getByLabelText("Pass E2"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Verdict not recorded: no such episode")).toBe(true));
    // the fail modal can be dismissed without a verdict
    fireEvent.click(screen.getByLabelText("Fail E2"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByText("Cancel"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Fail E2"));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });                         // Esc closes too
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // then the server vanishes mid-session
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    fireEvent.click(screen.getByLabelText("Pass E2"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Offline — verdict not recorded")).toBe(true));
  });
});

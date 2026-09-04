import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { Programming, toIso, weekStart } from "../src/views/Programming";
import { renderWithStore, getStore, stubFetch, SIGNALS, goOnline } from "./helpers";

function todayAt(h: number): string {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

const ROWS = {
  now: "t",
  series: [
    { slug: "kaanch-ka-mahal", title: "Kaanch Ka Mahal", language: "Hindi", episodeCount: 60,
      status: "scheduled", release_at: todayAt(20), scheduled_by: "nikhil",
      scheduled_at: "2026-09-01T00:00:00+00:00" },
    { slug: "ceo-sahab", title: "CEO Sahab", language: "Hindi", episodeCount: 72,
      status: "live", release_at: "", scheduled_by: "", scheduled_at: "" },
    { slug: "prema", title: "Prema Pariksha", language: "Telugu", episodeCount: 50,
      status: "draft", release_at: "", scheduled_by: "", scheduled_at: "" },
  ],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("programming helpers", () => {
  it("weekStart lands on a Monday; toIso carries an explicit offset", () => {
    const m = weekStart(new Date(2026, 8, 3));          // Thu 3 Sep 2026
    expect(m.getDay()).toBe(1);
    expect(m.getDate()).toBe(31);
    expect(weekStart(new Date(2026, 8, 7)).getDate()).toBe(7);   // a Monday stays
    const iso = toIso("2026-09-20T20:00");
    expect(iso.endsWith("+00:00")).toBe(true);
    expect(new Date(iso).getTime()).toBe(new Date("2026-09-20T20:00").getTime());
  });
});

describe("Programming calendar", () => {
  it("offline: empty week and no series", async () => {
    renderWithStore(<Programming />);
    await screen.findByText("No series");
    expect(screen.getAllByText("no drop")).toHaveLength(7);
  });

  it("puts this week's drop on its day, navigates weeks, lists every series", async () => {
    stubFetch({ ...SIGNALS, "/programming": () => ROWS });
    renderWithStore(<Programming />);
    await screen.findAllByText("Kaanch Ka Mahal");
    expect(screen.getAllByText("no drop")).toHaveLength(6);
    expect(document.querySelector(".day.today")).not.toBeNull();
    const heading = screen.getByText(/Week of/).textContent;
    fireEvent.click(screen.getByText("Next week ›"));
    expect(screen.getByText(/Week of/).textContent).not.toBe(heading);
    expect(screen.getAllByText("no drop")).toHaveLength(7);
    fireEvent.click(screen.getByText("‹ Prev week"));
    fireEvent.click(screen.getByText("‹ Prev week"));
    fireEvent.click(screen.getByText("Today"));
    expect(screen.getByText(/Week of/).textContent).toBe(heading);
    expect(screen.getByText(/by nikhil/)).toBeInTheDocument();
    // live series has no Publish; scheduled + draft do; only scheduled can unschedule
    expect(screen.getAllByText("Publish now")).toHaveLength(2);
    expect(screen.getAllByText("Unschedule")).toHaveLength(1);
  });

  it("schedules, unschedules and publishes through the server's answers", async () => {
    const calls = stubFetch({
      "/catalog/series/prema/schedule": () => ({ slug: "prema", status: "scheduled" }),
      "/catalog/series/kaanch-ka-mahal/schedule": () => ({ slug: "kaanch-ka-mahal", status: "draft" }),
      "/catalog/series/prema/status": () => ({ slug: "prema", status: "live" }),
      ...SIGNALS, "/programming": () => ROWS,
    });
    renderWithStore(<Programming />);
    await screen.findAllByText("Kaanch Ka Mahal");
    await goOnline();
    fireEvent.click(screen.getByLabelText("Schedule Prema Pariksha"));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("Schedule")).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("Release at"), { target: { value: "2026-09-20T20:00" } });
    fireEvent.click(within(dlg).getByText("Schedule"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Scheduled · status now scheduled · audited")).toBe(true));
    const sched = calls.find((c) => c.url.includes("/prema/schedule"));
    expect(sched?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(sched?.init?.body))).toEqual({
      release_at: toIso("2026-09-20T20:00"), confirm: "prema" });

    fireEvent.click(screen.getByLabelText("Unschedule Kaanch Ka Mahal"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Unscheduled · status now draft · audited")).toBe(true));
    const un = calls.find((c) => c.url.includes("/kaanch-ka-mahal/schedule"));
    expect(JSON.parse(String(un?.init?.body))).toEqual({ release_at: "", confirm: "kaanch-ka-mahal" });

    fireEvent.click(screen.getByLabelText("Publish Prema Pariksha"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Published · status now live · audited")).toBe(true));
    const pub = calls.find((c) => c.url.includes("/prema/status"));
    expect(JSON.parse(String(pub?.init?.body))).toEqual({ status: "live", reason: "" });
  });

  it("refusals and offline are surfaced; the modal cancels", async () => {
    stubFetch({
      "/schedule": () => ({ __status: 428, detail: "type the slug to confirm" }),
      ...SIGNALS, "/programming": () => ROWS,
    });
    renderWithStore(<Programming />);
    await screen.findAllByText("Kaanch Ka Mahal");
    await goOnline();
    fireEvent.click(screen.getByLabelText("Unschedule Kaanch Ka Mahal"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Unscheduled refused: type the slug to confirm")).toBe(true));
    fireEvent.click(screen.getByLabelText("Schedule CEO Sahab"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByText("Cancel"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Schedule CEO Sahab"));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    fireEvent.click(screen.getByLabelText("Unschedule Kaanch Ka Mahal"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Offline — Unscheduled not applied")).toBe(true));
    expect(screen.getByLabelText("Unschedule Kaanch Ka Mahal")).toBeDisabled();
  });
});

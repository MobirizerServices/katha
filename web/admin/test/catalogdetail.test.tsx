import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { CatalogDetail } from "../src/views/CatalogDetail";
import { renderWithStore, getStore } from "./helpers";

const DETAIL = {
  slug: "kaanch-ka-mahal", title: "Kaanch Ka Mahal",
  synopsis: "Meera finds a stranger in every wedding photo.",
  genres: ["Family Drama"], language: "Hindi",
  episodeCount: 60, freeEpisodes: 10, coinPrice: 30, bundleDiscountPct: 25,
  status: "live", rating: "U/A 13+",
  ratingHistory: { value: "U/A 13+", by: "dev", at: "2026-09-01T10:00:00+00:00", reason: "review" },
  updatedAt: "2026-09-01T10:00:00+00:00",
  coverUrl: "http://x/cover.jpg",
  media: { covers_ok: true, episodes_with_media: 60, episodes_missing: 0 },
  episodes: [{ number: 1, title: "One face too many", isFree: true },
             { number: 11, title: "The signature", isFree: false }],
  previewWeb: "http://localhost:3000/watch/kaanch-ka-mahal/1",
};

function stubDetailServer(calls: { status?: unknown; rating?: unknown }) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/status")) {
      calls.status = JSON.parse(String(init?.body));
      return Promise.resolve({ ok: true, json: async () => ({ slug: DETAIL.slug, status: "archived" }) });
    }
    if (u.includes("/rating")) {
      calls.rating = JSON.parse(String(init?.body));
      return Promise.resolve({ ok: true, json: async () => ({ slug: DETAIL.slug, rating: {} }) });
    }
    if (u.includes("/catalog/series/kaanch-ka-mahal")) {
      return Promise.resolve({ ok: true, json: async () => DETAIL });
    }
    if (u.includes("/health/full")) {
      return Promise.resolve({ ok: true, json: async () => ({ status: "ok", checks: {}, at: "" }) });
    }
    if (u.includes("/attention")) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    }
    return Promise.reject(new Error("offline"));
  }));
}

function renderDetail() {
  return renderWithStore(
    <Routes>
      <Route path="/catalog/:slug" element={<CatalogDetail />} />
    </Routes>,
    { route: "/catalog/kaanch-ka-mahal" }
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Catalog series detail", () => {
  it("shows not-found offline (no fixture pretends to be a series)", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText("Series not found")).toBeInTheDocument());
  });

  it("renders publishing, rating accountability and media health", async () => {
    stubDetailServer({});
    renderDetail();
    await waitFor(() => expect(screen.getByText("Kaanch Ka Mahal")).toBeInTheDocument());
    expect(screen.getByText("U/A 13+")).toBeInTheDocument();
    expect(screen.getByText(/Rated by/)).toBeInTheDocument();
    expect(screen.getByText("60 / 60")).toBeInTheDocument();
    expect(screen.getByText("complete")).toBeInTheDocument();
    expect(screen.getByText("Preview on web ↗")).toHaveAttribute("href", DETAIL.previewWeb);
  });

  it("takedown demands a reason and posts it (#046)", async () => {
    const calls: { status?: { status?: string; reason?: string } } = {};
    stubDetailServer(calls);
    renderDetail();
    await waitFor(() => expect(screen.getByText("Take down…")).toBeInTheDocument());
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    fireEvent.click(screen.getByText("Take down…"));
    const dialog = await screen.findByRole("dialog");
    const go = within(dialog).getByText("Take down now");
    expect(go).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/),
                     { target: { value: "G-XY99 legal notice" } });
    fireEvent.click(go);
    await waitFor(() => expect(calls.status?.reason).toBe("G-XY99 legal notice"));
    expect(calls.status?.status).toBe("archived");
  });

  it("rating changes require a why and carry it to the server (#041)", async () => {
    const calls: { rating?: { rating?: string; reason?: string } } = {};
    stubDetailServer(calls);
    renderDetail();
    await waitFor(() => expect(screen.getByText("Change…")).toBeInTheDocument());
    act(() => getStore().refreshSignals());
    await waitFor(() => expect(getStore().online).toBe(true));
    fireEvent.click(screen.getByText("Change…"));
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByText("Save rating");
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Rating"), { target: { value: "U/A 16+" } });
    fireEvent.change(within(dialog).getByLabelText(/Why/),
                     { target: { value: "episode 41 violence" } });
    fireEvent.click(save);
    await waitFor(() => expect(calls.rating?.rating).toBe("U/A 16+"));
    expect(calls.rating?.reason).toBe("episode 41 violence");
  });
});

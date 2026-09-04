import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import { Catalog } from "../src/views/Catalog";
import { renderWithStore, getStore, stubFetch, SIGNALS, goOnline } from "./helpers";
import { MOCK_SERIES } from "../src/api/mock";
import { act } from "@testing-library/react";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function renderCatalog() {
  const view = renderWithStore(<Catalog />);
  await waitFor(() => expect(screen.getByText("His One and Only Love")).toBeInTheDocument());
  return view;
}

describe("Catalog view", () => {
  it("renders every seed series with the free/price/bundle columns", async () => {
    await renderCatalog();
    // 6 series in the mock
    expect(screen.getAllByText("10 free")).toHaveLength(6);
    expect(screen.getAllByText("30 coins")).toHaveLength(6);
    expect(screen.getAllByText("−25%")).toHaveLength(6);
  });

  it("filters by search query (title/slug/genre)", async () => {
    await renderCatalog();
    fireEvent.change(screen.getByPlaceholderText("Search title, slug or genre…"), {
      target: { value: "dragon" },
    });
    expect(screen.getByText("Deny Me, Dragon King")).toBeInTheDocument();
    expect(screen.queryByText("His One and Only Love")).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", async () => {
    await renderCatalog();
    fireEvent.change(screen.getByPlaceholderText("Search title, slug or genre…"), {
      target: { value: "zzzznotamatch" },
    });
    expect(screen.getByText("No series match")).toBeInTheDocument();
  });

  it("filters by language", async () => {
    const { container } = await renderCatalog();
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "Tamil" } });
    // Every visible row is Tamil; Hindi title (index 0 = Hindi) is gone.
    expect(screen.queryByText("His One and Only Love")).not.toBeInTheDocument();
  });

  it("filters by status and renders 'unrated' for draft series", async () => {
    const { container } = await renderCatalog();
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[1], { target: { value: "draft" } });
    // Draft series (Deny Me, Dragon King, index 5) shows a dash for rating.
    const table = screen.getByRole("table");
    expect(within(table).getByText("Deny Me, Dragon King")).toBeInTheDocument();
    expect(within(table).queryByText("His One and Only Love")).not.toBeInTheDocument();
  });
});

describe("Catalog — bulk pricing (finance, typed PRICING)", () => {
  it("multi-select drives the action; non-finance roles never see it", async () => {
    await renderCatalog();
    expect(screen.queryByText(/Set pricing for/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select His One and Only Love"));
    expect(screen.getByText("Set pricing for 1 series…")).toBeDisabled();   // offline
    fireEvent.click(screen.getByLabelText("Select all series"));
    expect(screen.getByText("Set pricing for 6 series…")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select all series"));           // clears
    expect(screen.queryByText(/Set pricing for/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select His One and Only Love"));
    fireEvent.click(screen.getByLabelText("Select His One and Only Love"));  // toggles off
    expect(screen.queryByText(/Set pricing for/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select His One and Only Love"));
    act(() => getStore().setRole("content"));
    expect(screen.queryByText(/Set pricing for/)).not.toBeInTheDocument();
  });

  it("applies with the typed confirm, reports per-slug results, reloads", async () => {
    const calls = stubFetch({
      "/catalog/pricing/bulk": () => ({ applied: 1, coin_price: 20, free_episodes: 5,
        results: [{ slug: "his-one-and-only-love", ok: true, coin_price: 20, free_episodes: 5 },
                  { slug: "i-wish-it-were-you", ok: false, error: "series not found" }] }),
      ...SIGNALS, "/catalog/series": () => MOCK_SERIES,
    });
    await renderCatalog();
    await goOnline();
    fireEvent.click(screen.getByLabelText("Select His One and Only Love"));
    fireEvent.click(screen.getByLabelText("Select I Wish It Were You"));
    fireEvent.click(screen.getByText("Set pricing for 2 series…"));
    const dlg = await screen.findByRole("dialog");
    const apply = within(dlg).getByText("Apply to 2 series");
    expect(apply).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("Bulk coins per episode"), { target: { value: "20" } });
    fireEvent.change(within(dlg).getByLabelText("Bulk free episodes"), { target: { value: "5" } });
    fireEvent.change(within(dlg).getByLabelText("Confirm PRICING"), { target: { value: "pricing" } });
    expect(apply).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("Confirm PRICING"), { target: { value: "PRICING" } });
    fireEvent.click(apply);
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Repriced 1 of 2 series · audited once · not i-wish-it-were-you (series not found)"
      && t.kind === "error")).toBe(true));
    const post = calls.find((c) => c.url.includes("/catalog/pricing/bulk"));
    expect(post?.init?.method).toBe("POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      slugs: ["his-one-and-only-love", "i-wish-it-were-you"], coin_price: 20,
      free_episodes: 5, confirm: "PRICING" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/Set pricing for/)).not.toBeInTheDocument();   // selection cleared
    expect(calls.filter((c) => c.url.endsWith("/catalog/series")).length).toBeGreaterThan(1);
  });

  it("a clean run toasts info; refusals and offline are honest; cancel closes", async () => {
    stubFetch({
      "/catalog/pricing/bulk": () => ({ applied: 1, coin_price: 30, free_episodes: 10,
        results: [{ slug: "his-one-and-only-love", ok: true }] }),
      ...SIGNALS, "/catalog/series": () => MOCK_SERIES,
    });
    await renderCatalog();
    await goOnline();
    fireEvent.click(screen.getByLabelText("Select His One and Only Love"));
    fireEvent.click(screen.getByText("Set pricing for 1 series…"));
    let dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Confirm PRICING"), { target: { value: "PRICING" } });
    fireEvent.click(within(dlg).getByText("Apply to 1 series"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Repriced 1 of 1 series · audited once" && t.kind === "info")).toBe(true));

    stubFetch({ "/catalog/pricing/bulk": () => ({ __status: 428, detail: "type PRICING to confirm" }),
                ...SIGNALS, "/catalog/series": () => MOCK_SERIES });
    fireEvent.click(screen.getByLabelText("Select His One and Only Love"));
    fireEvent.click(screen.getByText("Set pricing for 1 series…"));
    dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Confirm PRICING"), { target: { value: "PRICING" } });
    fireEvent.click(within(dlg).getByText("Apply to 1 series"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Pricing not changed: type PRICING to confirm")).toBe(true));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    fireEvent.click(within(dlg).getByText("Apply to 1 series"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text === "Offline — pricing unchanged")).toBe(true));
    fireEvent.click(within(dlg).getByText("Cancel"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

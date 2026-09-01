import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import { Catalog } from "../src/views/Catalog";
import { renderWithStore } from "./helpers";

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

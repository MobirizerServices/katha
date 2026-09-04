import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SERIES } from "@/lib/catalog";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: any) =>
    React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
let search = "";
const replace = vi.fn((url: string) => { search = url.includes("?") ? url.split("?")[1] : ""; });
const router = { push: vi.fn(), replace };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

import Browse from "@/components/Browse";

const cards = () => screen.queryAllByTestId(/^card-/);

beforeEach(() => {
  search = "";
  replace.mockClear();
});

describe("Browse — filters live in the query string", () => {
  it("shows the whole catalog with language and genre chips", () => {
    render(<Browse series={SERIES} />);
    expect(cards()).toHaveLength(SERIES.length);
    expect(screen.getByText(`${SERIES.length} series · first 10 episodes of each are free`)).toBeInTheDocument();
    const langs = screen.getByRole("group", { name: "Language" });
    expect(within(langs).getByRole("button", { name: "All languages" })).toHaveAttribute("aria-pressed", "true");
    expect(within(langs).getByRole("button", { name: /Tamil/ })).toBeInTheDocument();
    const genres = screen.getByRole("group", { name: "Genre" });
    expect(within(genres).getByRole("button", { name: "Romance" })).toBeInTheDocument();
  });

  it("a chip rewrites the URL; the URL drives the grid", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Browse series={SERIES} />);
    await user.click(screen.getByRole("button", { name: /Tamil/ }));
    expect(replace).toHaveBeenCalledWith("/browse?lang=ta");
    rerender(<Browse series={SERIES} />);
    const tamil = SERIES.filter((s) => s.language === "Tamil");
    expect(cards()).toHaveLength(tamil.length);
    expect(screen.getByRole("button", { name: /Tamil/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Romance" }));
    expect(replace).toHaveBeenLastCalledWith("/browse?lang=ta&genre=Romance");
    rerender(<Browse series={SERIES} />);
    expect(cards()).toHaveLength(tamil.filter((s) => s.genres.includes("Romance")).length);

    await user.click(screen.getByRole("button", { name: "All genres" }));
    expect(replace).toHaveBeenLastCalledWith("/browse?lang=ta");
    rerender(<Browse series={SERIES} />);
    await user.click(screen.getByRole("button", { name: "All languages" }));
    expect(replace).toHaveBeenLastCalledWith("/browse");
  });

  it("an empty result shows the empty state with a clear-filters link", () => {
    search = "lang=xx&genre=Horror";
    render(<Browse series={SERIES} />);
    expect(cards()).toHaveLength(0);
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/browse");
  });

  it("cards link to the series page and carry language · genre · episodes", () => {
    render(<Browse series={[{ ...SERIES[0], genres: [] }]} />);
    const card = screen.getByTestId(`card-${SERIES[0].slug}`);
    expect(within(card).getByRole("link", { name: SERIES[0].title })).toHaveAttribute("href", `/series/${SERIES[0].slug}`);
    expect(card).toHaveTextContent(`${SERIES[0].language} · ${SERIES[0].episodeCount} episodes`);
  });
});

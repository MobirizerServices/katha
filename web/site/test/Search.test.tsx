import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { summary } from "./walletStub";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: any) =>
    React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
let search = "";
const replace = vi.fn();
const router = { push: vi.fn(), replace };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));
const searchApi = vi.fn();
vi.mock("@/lib/api", () => ({ api: { search: (...a: unknown[]) => searchApi(...a) } }));

import Search from "@/components/Search";

const hit = (over = {}) => ({
  query: "ceo",
  series: [summary("ceo-sahab", { title: "CEO Sahab", genres: ["Romance"], primary_language: "hi" })],
  people: [
    { name: "Arjun Rao", role: "Lead", series: [summary("ceo-sahab", { title: "CEO Sahab" }), summary("raja-ki-beti", { title: "Raja Ki Beti", genres: [] })] },
  ],
  ...over,
});

beforeEach(() => {
  search = "";
  replace.mockClear();
  searchApi.mockReset();
});

describe("Search — debounced, server-ranked", () => {
  it("starts idle with suggestion chips; a chip fills the box and searches after the debounce", async () => {
    const user = userEvent.setup();
    searchApi.mockResolvedValue(hit());
    render(<Search />);
    expect(screen.getByRole("heading", { name: "Search" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "revenge" }));
    expect(screen.getByLabelText("Search")).toHaveValue("revenge");
    expect(screen.getByText("Searching…")).toBeInTheDocument();
    expect(searchApi).not.toHaveBeenCalled();                       // not before the debounce
    await waitFor(() => expect(searchApi).toHaveBeenCalledWith("revenge"));
    expect(replace).toHaveBeenCalledWith("/search?q=revenge");
    expect(await screen.findByRole("heading", { name: "Results for “revenge”" })).toBeInTheDocument();
    expect(screen.getByText("1 series · 1 people")).toBeInTheDocument();
  });

  it("renders Series and People sections; a person row expands to their series", async () => {
    const user = userEvent.setup();
    search = "q=ceo";
    searchApi.mockResolvedValue(hit());
    render(<Search />);
    expect(screen.getByLabelText("Search")).toHaveValue("ceo");
    const seriesSec = await screen.findByRole("region", { name: "Series" });
    expect(within(seriesSec).getByTestId("card-ceo-sahab")).toHaveTextContent("Hindi · Romance · 60 episodes");
    const people = screen.getByRole("region", { name: "People" });
    const row = within(people).getByRole("button", { name: /Arjun Rao · Lead · 2 series/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(within(people).queryByTestId("card-raja-ki-beti")).not.toBeInTheDocument();
    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(within(people).getByTestId("card-raja-ki-beti")).toBeInTheDocument();
    await user.click(row);
    expect(within(people).queryByTestId("card-raja-ki-beti")).not.toBeInTheDocument();
  });

  it("no hits at all is the empty state with a browse link; a failing server is an alert", async () => {
    const user = userEvent.setup();
    search = "q=zzz";
    searchApi.mockResolvedValueOnce(hit({ series: [], people: [] })).mockRejectedValueOnce(new Error("down"));
    render(<Search />);
    expect(await screen.findByText("Nothing for “zzz”")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse all" })).toHaveAttribute("href", "/browse");
    await user.type(screen.getByLabelText("Search"), "y");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Search is unavailable/);
  });

  it("only the last term is searched; a stale answer that lands after a change is ignored", async () => {
    const user = userEvent.setup();
    let resolveFirst!: (v: unknown) => void;
    searchApi.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    render(<Search />);
    const box = screen.getByLabelText("Search");
    await user.type(box, "c");
    await user.type(box, "e");                       // within the debounce: one call at most
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(1));
    expect(searchApi).toHaveBeenCalledWith("ce");
    await user.clear(box);                            // back to idle: the pending answer must not paint
    resolveFirst(hit());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("region", { name: "Series" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Search" })).toBeInTheDocument();
  });

  it("a rejection that lands after the term changed is ignored too", async () => {
    const user = userEvent.setup();
    let rejectFirst!: (e: unknown) => void;
    searchApi.mockImplementationOnce(() => new Promise((_r, rej) => { rejectFirst = rej; }));
    render(<Search />);
    await user.type(screen.getByLabelText("Search"), "x");
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(1));
    await user.clear(screen.getByLabelText("Search"));
    rejectFirst(new Error("late"));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

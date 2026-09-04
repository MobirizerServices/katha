import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WalletCtx } from "@/components/WalletProvider";
import { makeWallet, summary } from "./walletStub";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: any) =>
    React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
let mockWallet: WalletCtx;
vi.mock("@/components/WalletProvider", () => ({ useWallet: () => mockWallet }));
const apiMock = vi.hoisted(() => ({
  myList: vi.fn(), removeFromList: vi.fn(), reminders: vi.fn(), addReminder: vi.fn(), removeReminder: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));

import MyList from "@/components/MyList";

const LIST = [summary("ceo-sahab", { title: "CEO Sahab" }), summary("raja-ki-beti", { title: "Raja Ki Beti", primary_language: "ta", genres: [] })];

beforeEach(() => {
  for (const f of Object.values(apiMock)) f.mockReset();
  apiMock.myList.mockResolvedValue({ slugs: LIST.map((s) => s.slug), series: LIST });
  apiMock.reminders.mockResolvedValue({ slugs: ["raja-ki-beti"] });
  mockWallet = makeWallet({ signed: true, name: "Asha" });
});

describe("MyList — the server's list, with remove and reminder bells", () => {
  it("waits for the session, then asks a guest to sign in (and never fetches)", async () => {
    const user = userEvent.setup();
    mockWallet = makeWallet({ ready: false });
    const { rerender } = render(<MyList />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    const openSignIn = vi.fn();
    mockWallet = makeWallet({ signed: false, openSignIn });
    rerender(<MyList />);
    await user.click(screen.getByRole("button", { name: "Sign in with phone" }));
    expect(openSignIn).toHaveBeenCalledWith("/mylist");
    expect(apiMock.myList).not.toHaveBeenCalled();
  });

  it("renders the list with bells reflecting /v1/me/reminders", async () => {
    render(<MyList />);
    expect(screen.getByText("Loading your list…")).toBeInTheDocument();
    const card = await screen.findByTestId("card-ceo-sahab");
    expect(card).toHaveTextContent("Hindi · Romance · 60 episodes");
    expect(within(card).getByRole("button", { name: "Remind me about CEO Sahab" })).toHaveAttribute("aria-pressed", "false");
    const card2 = screen.getByTestId("card-raja-ki-beti");
    expect(card2).toHaveTextContent("Tamil · 60 episodes");
    expect(within(card2).getByRole("button", { name: "Stop reminders for Raja Ki Beti" })).toHaveAttribute("aria-pressed", "true");
  });

  it("remove drops the card from the server's answer; a failure toasts", async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    mockWallet = makeWallet({ signed: true, toast });
    apiMock.removeFromList.mockResolvedValueOnce({ slugs: ["raja-ki-beti"], series: [LIST[1]] }).mockRejectedValueOnce(new Error("down"));
    render(<MyList />);
    await user.click(await screen.findByRole("button", { name: "Remove CEO Sahab from my list" }));
    expect(apiMock.removeFromList).toHaveBeenCalledWith("ceo-sahab");
    expect(await screen.findByTestId("card-raja-ki-beti")).toBeInTheDocument();
    expect(screen.queryByTestId("card-ceo-sahab")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Raja Ki Beti from my list" }));
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("Couldn't update your list — try again"));
    expect(screen.getByTestId("card-raja-ki-beti")).toBeInTheDocument();
  });

  it("the bell PUTs then DELETEs the reminder, and reports failures", async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    mockWallet = makeWallet({ signed: true, toast });
    apiMock.addReminder.mockResolvedValue({ slugs: ["raja-ki-beti", "ceo-sahab"] });
    apiMock.removeReminder.mockResolvedValueOnce({ slugs: ["ceo-sahab"] }).mockRejectedValueOnce(new Error("down"));
    render(<MyList />);
    await user.click(await screen.findByRole("button", { name: "Remind me about CEO Sahab" }));
    expect(apiMock.addReminder).toHaveBeenCalledWith("ceo-sahab");
    expect(await screen.findByRole("button", { name: "Stop reminders for CEO Sahab" })).toBeInTheDocument();
    expect(toast).toHaveBeenLastCalledWith("We'll tell you when a new episode drops");
    await user.click(screen.getByRole("button", { name: "Stop reminders for Raja Ki Beti" }));
    expect(apiMock.removeReminder).toHaveBeenCalledWith("raja-ki-beti");
    expect(await screen.findByRole("button", { name: "Remind me about Raja Ki Beti" })).toBeInTheDocument();
    expect(toast).toHaveBeenLastCalledWith("Reminder off");
    await user.click(screen.getByRole("button", { name: "Stop reminders for CEO Sahab" }));
    await vi.waitFor(() => expect(toast).toHaveBeenLastCalledWith("Couldn't save the reminder — try again"));
  });

  it("an empty list shows the empty state; a failed load is an alert; failed reminders just show off", async () => {
    apiMock.myList.mockResolvedValueOnce({ slugs: [], series: [] });
    apiMock.reminders.mockRejectedValue(new Error("down"));
    const first = render(<MyList />);
    expect(await screen.findByText("Your list is empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse series" })).toHaveAttribute("href", "/browse");
    first.unmount();

    apiMock.myList.mockRejectedValueOnce(new Error("down"));
    render(<MyList />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't load your list/);
  });

  it("answers that land after unmount are dropped", async () => {
    let resolve!: (v: unknown) => void;
    apiMock.myList.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const { unmount } = render(<MyList />);
    unmount();
    resolve({ slugs: [], series: [] });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Your list is empty")).not.toBeInTheDocument();
  });
});

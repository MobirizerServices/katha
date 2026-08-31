import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WalletCtx } from "@/components/WalletProvider";
import { getSeries, bundleCost } from "@/lib/catalog";

// next/link + next/navigation are framework glue; stub them to plain DOM.
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: any) =>
    React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// Controllable wallet context shared by Player + SiteHeader.
let mockWallet: WalletCtx;
vi.mock("@/components/WalletProvider", async (orig) => {
  const actual = await orig<typeof import("@/components/WalletProvider")>();
  return { ...actual, useWallet: () => mockWallet };
});

import Player from "@/components/Player";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

const series = getSeries("ceo-sahab")!; // 72 episodes
const BUNDLE = bundleCost(series); // 1395

function makeWallet(over: Partial<WalletCtx> = {}): WalletCtx {
  return {
    signed: false,
    phone: "",
    name: "",
    bought: 0,
    bonus: 0,
    firstPack: true,
    unlocked: {},
    balance: 0,
    ready: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
    openSignIn: vi.fn(),
    hasUnlocked: vi.fn(() => false),
    unlockEpisode: vi.fn(() => true),
    unlockBundle: vi.fn(() => true),
    purchase: vi.fn(),
    toast: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  push.mockClear();
  mockWallet = makeWallet();
});

describe("Player — free episodes play", () => {
  it("renders the video and free-episode label for episode <= 10, no paywall", () => {
    render(<Player series={series} n={3} />);
    expect(screen.getByText(/Free episode 3 of 10/)).toBeInTheDocument();
    expect(document.querySelector("video")).not.toBeNull();
    expect(screen.queryByText(/Unlock Episode/)).not.toBeInTheDocument();
  });

  it("attaches native HLS and reveals the video on loadeddata when the browser can play m3u8", async () => {
    // Force the native-HLS branch (Safari-style) instead of hls.js.
    const canPlay = vi
      .spyOn(window.HTMLMediaElement.prototype, "canPlayType")
      .mockReturnValue("maybe");
    render(<Player series={series} n={2} />);
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    // Effect set the demo source and registered a one-time loadeddata listener.
    await vi.waitFor(() => expect(video.src).toContain(".m3u8"));
    // Fire loadeddata -> setVideoOk(true) reveals the <video>.
    act(() => {
      video.dispatchEvent(new Event("loadeddata"));
    });
    expect(video.style.opacity).toBe("1");
    canPlay.mockRestore();
  });

  it("Next / Previous route to adjacent episodes", async () => {
    const user = userEvent.setup();
    render(<Player series={series} n={3} />);
    await user.click(screen.getByRole("button", { name: "Next episode" }));
    expect(push).toHaveBeenCalledWith("/watch/ceo-sahab/4");
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(push).toHaveBeenCalledWith("/watch/ceo-sahab/2");
  });
});

describe("Player — paywall at episode 11 (locked)", () => {
  it("shows the paywall when a locked episode is not unlocked", () => {
    mockWallet = makeWallet({ signed: false });
    render(<Player series={series} n={11} />);
    expect(screen.getByText("Unlock Episode 11")).toBeInTheDocument();
    expect(document.querySelector("video")).toBeNull();
  });

  it("prompts a signed-out viewer to sign in", async () => {
    const user = userEvent.setup();
    const openSignIn = vi.fn();
    mockWallet = makeWallet({ signed: false, openSignIn });
    render(<Player series={series} n={11} />);
    await user.click(screen.getByRole("button", { name: /Sign in to continue/ }));
    expect(openSignIn).toHaveBeenCalledWith("/watch/ceo-sahab/11");
  });

  it("a signed viewer with enough coins can unlock the single episode for 30 coins", async () => {
    const user = userEvent.setup();
    const unlockEpisode = vi.fn(() => true);
    const toast = vi.fn();
    mockWallet = makeWallet({ signed: true, bought: 2000, balance: 2000, unlockEpisode, toast });
    render(<Player series={series} n={11} />);
    await user.click(screen.getByRole("button", { name: /Unlock for 30 coins/ }));
    expect(unlockEpisode).toHaveBeenCalledWith("ceo-sahab", 11, 30);
    expect(toast).toHaveBeenCalledWith("Episode 11 unlocked · −30 coins");
  });

  it("shows the bundle option at 25% off and unlocks all remaining episodes", async () => {
    const user = userEvent.setup();
    const unlockBundle = vi.fn(() => true);
    const toast = vi.fn();
    mockWallet = makeWallet({ signed: true, bought: 5000, balance: 5000, unlockBundle, toast });
    render(<Player series={series} n={11} />);
    // Bundle button shows the discounted price and the -25% badge.
    const bundleBtn = screen.getByRole("button", { name: /Unlock all .* left/ });
    expect(bundleBtn).toHaveTextContent("1,395");
    expect(bundleBtn).toHaveTextContent("−25%");
    await user.click(bundleBtn);
    expect(unlockBundle).toHaveBeenCalledWith("ceo-sahab", BUNDLE);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("−1,395 coins"));
  });

  it("blocks the bundle purchase and toasts when the viewer cannot afford it", async () => {
    const user = userEvent.setup();
    const unlockBundle = vi.fn(() => true);
    const toast = vi.fn();
    mockWallet = makeWallet({ signed: true, bought: 100, balance: 100, unlockBundle, toast });
    render(<Player series={series} n={11} />);
    // balance (100) >= EPISODE_COIN_PRICE (30) so the single-unlock path renders;
    // the bundle (1395) is unaffordable.
    await user.click(screen.getByRole("button", { name: /Unlock all .* left/ }));
    expect(toast).toHaveBeenCalledWith("Not enough coins for the full bundle");
    expect(unlockBundle).not.toHaveBeenCalled();
  });

  it("directs a signed viewer who is short on coins to the coin store", () => {
    // balance 10 < 30 -> need = 20; shows the 'Get coins' CTA and a disabled unlock.
    mockWallet = makeWallet({ signed: true, bought: 10, balance: 10 });
    render(<Player series={series} n={11} />);
    expect(screen.getByText(/you need 20 more/)).toBeInTheDocument();
    const disabled = screen.getByRole("button", { name: "Unlock for 30" });
    expect(disabled).toBeDisabled();
  });

  it("treats an unlocked locked-episode as watchable (no paywall)", () => {
    mockWallet = makeWallet({ signed: true, hasUnlocked: vi.fn(() => true) });
    render(<Player series={series} n={11} />);
    expect(screen.getByText(/Unlocked episode/)).toBeInTheDocument();
    expect(screen.queryByText("Unlock Episode 11")).not.toBeInTheDocument();
  });

  it("hides the bundle button when only one locked episode remains", () => {
    // hasUnlocked true for every OTHER locked episode -> remaining === 1
    const hasUnlocked = vi.fn((_s: string, n: number) => n !== 11);
    mockWallet = makeWallet({ signed: true, bought: 5000, balance: 5000, hasUnlocked });
    // n=11 itself must read as locked: accessible = hasUnlocked(11) = false
    render(<Player series={series} n={11} />);
    expect(screen.getByText("Unlock Episode 11")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Unlock all/ })).not.toBeInTheDocument();
  });
});

describe("Player — pre-hydration", () => {
  it("does not lock the view until the wallet is ready", () => {
    mockWallet = makeWallet({ ready: false });
    render(<Player series={series} n={11} />);
    // locked requires ready; before hydration neither paywall nor video label forced
    expect(screen.queryByText("Unlock Episode 11")).not.toBeInTheDocument();
  });
});

describe("SiteHeader", () => {
  it("shows the coin balance and a Sign in button when signed out", async () => {
    const user = userEvent.setup();
    const openSignIn = vi.fn();
    mockWallet = makeWallet({ ready: true, balance: 1300, signed: false, openSignIn });
    render(<SiteHeader />);
    expect(screen.getByLabelText("Coin balance")).toHaveTextContent("1,300");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(openSignIn).toHaveBeenCalled();
  });

  it("shows the profile avatar initial when signed in", () => {
    mockWallet = makeWallet({ ready: true, signed: true, name: "Meera", balance: 0 });
    render(<SiteHeader />);
    expect(screen.getByLabelText("Profile")).toHaveTextContent("M");
  });

  it("shows 0 before the wallet is ready", () => {
    mockWallet = makeWallet({ ready: false, balance: 999 });
    render(<SiteHeader />);
    expect(screen.getByLabelText("Coin balance")).toHaveTextContent("0");
  });
});

describe("SiteFooter", () => {
  it("renders legal + grievance information", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("heading", { name: "Legal" })).toBeInTheDocument();
    expect(screen.getByText(/Grievance officer/)).toBeInTheDocument();
    expect(screen.getByText(/© 2026 Katha Media/)).toBeInTheDocument();
  });
});

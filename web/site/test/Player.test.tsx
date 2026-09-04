import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WalletCtx } from "@/components/WalletProvider";
import { getSeries } from "@/lib/catalog";

// next/link + next/navigation are framework glue; stub them to plain DOM.
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: any) =>
    React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// The server's answer is the only access decision: stub it per test.
const playback = vi.fn();
vi.mock("@/lib/api", () => ({ api: { playback: (...a: unknown[]) => playback(...a) } }));

// hls.js is mocked so the MSE branch (what Chrome runs) is exercised in jsdom.
type Handler = (evt: unknown, data: { fatal: boolean }) => void;
const hlsState = {
  supported: false,
  importFails: false,
  handlers: [] as Handler[],
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
};
vi.mock("hls.js", () => {
  class FakeHls {
    static isSupported() {
      if (hlsState.importFails) throw new Error("media stack crashed");
      return hlsState.supported;
    }
    static Events = { ERROR: "hlsError" };
    loadSource(u: string) { hlsState.loadSource(u); }
    attachMedia(v: unknown) { hlsState.attachMedia(v); }
    on(_e: string, h: Handler) { hlsState.handlers.push(h); }
    destroy() { hlsState.destroy(); }
  }
  return { default: FakeHls };
});

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
const STREAM = "http://127.0.0.1:8799/media/ceo-sahab/e002/hls/master.m3u8";

const playable = (free = true) => ({ locked: false, episode_id: "x", free, hls_master_url: STREAM });
const paywall = (over: Partial<{ price_coins: number; balance: number; remaining_locked: number; bundle_offer_coins: number }> = {}) => ({
  locked: true, episode_id: "x", price_coins: 30, balance: 0, remaining_locked: 62, bundle_offer_coins: 1395, ...over,
});

function makeWallet(over: Partial<WalletCtx> = {}): WalletCtx {
  return {
    signed: false,
    phone: "",
    name: "",
    bought: 0,
    bonus: 0,
    balance: 0,
    ready: true,
    signIn: vi.fn(async () => true),
    signOut: vi.fn(),
    openSignIn: vi.fn(),
    unlockEpisode: vi.fn(async () => ({ ok: true as const, spent: 30 })),
    unlockBundle: vi.fn(async () => ({ ok: true as const, spent: 1395 })),
    purchase: vi.fn(async () => 0),
    refreshWallet: vi.fn(async () => {}),
    toast: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  push.mockClear();
  playback.mockReset();
  mockWallet = makeWallet();
  hlsState.supported = false;
  hlsState.importFails = false;
  hlsState.handlers = [];
  hlsState.loadSource.mockClear();
  hlsState.attachMedia.mockClear();
  hlsState.destroy.mockClear();
});

describe("Player — the server's playback answer decides", () => {
  it("asks playback first and plays a free episode with no paywall", async () => {
    playback.mockResolvedValue(playable(true));
    render(<Player series={series} n={3} />);
    expect(playback).toHaveBeenCalledWith("ceo-sahab", 3);
    expect(await screen.findByText(/Free episode 3/)).toBeInTheDocument();
    expect(document.querySelector("video")).not.toBeNull();
    expect(screen.queryByText(/Unlock Episode/)).not.toBeInTheDocument();
  });

  it("labels a bought episode as unlocked", async () => {
    playback.mockResolvedValue(playable(false));
    render(<Player series={series} n={11} />);
    expect(await screen.findByText(/Unlocked episode/)).toBeInTheDocument();
  });

  it("does not ask the server until the wallet session is ready, and shows nothing locked meanwhile", () => {
    mockWallet = makeWallet({ ready: false });
    render(<Player series={series} n={11} />);
    expect(playback).not.toHaveBeenCalled();
    expect(screen.queryByText("Unlock Episode 11")).not.toBeInTheDocument();
    expect(document.querySelector("video")).toBeNull();
  });

  it("attaches native HLS from the server URL and reveals the video on loadeddata", async () => {
    const canPlay = vi
      .spyOn(window.HTMLMediaElement.prototype, "canPlayType")
      .mockReturnValue("maybe");
    playback.mockResolvedValue(playable(true));
    render(<Player series={series} n={2} />);
    const video = (await waitFor(() => {
      const v = document.querySelector("video");
      expect(v).not.toBeNull();
      return v;
    })) as HTMLVideoElement;
    await waitFor(() => expect(video.src).toContain("/media/ceo-sahab/e002/hls/master.m3u8"));
    act(() => {
      video.dispatchEvent(new Event("loadeddata"));
    });
    expect(video.style.opacity).toBe("1");
    canPlay.mockRestore();
  });

  it("a rejected playback call shows the stream error, and Try again re-asks", async () => {
    const user = userEvent.setup();
    playback.mockRejectedValueOnce(new Error("down")).mockResolvedValue(playable(true));
    render(<Player series={series} n={2} />);
    expect(await screen.findByText("Stream unavailable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Free episode 2/)).toBeInTheDocument();
    expect(playback).toHaveBeenCalledTimes(2);
  });

  it("an entitled answer without a stream URL is an error, never a stand-in", async () => {
    playback.mockResolvedValue({ locked: false, episode_id: "x", free: true, hls_master_url: "" });
    render(<Player series={series} n={2} />);
    expect(await screen.findByText("Stream unavailable")).toBeInTheDocument();
  });

  it("Next / Previous route to adjacent episodes", async () => {
    const user = userEvent.setup();
    playback.mockResolvedValue(playable(true));
    render(<Player series={series} n={3} />);
    await screen.findByText(/Free episode 3/);
    await user.click(screen.getByRole("button", { name: "Next episode" }));
    expect(push).toHaveBeenCalledWith("/watch/ceo-sahab/4");
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(push).toHaveBeenCalledWith("/watch/ceo-sahab/2");
  });
});

describe("Player — paywall rendered from the server payload", () => {
  it("shows the paywall for a locked episode, even below the old free window", async () => {
    // e.g. the series was repriced to fewer free episodes in the back office
    playback.mockResolvedValue(paywall());
    render(<Player series={series} n={9} />);
    expect(await screen.findByText("Unlock Episode 9")).toBeInTheDocument();
    expect(document.querySelector("video")).toBeNull();
  });

  it("prompts a signed-out viewer to sign in with the server's price", async () => {
    const user = userEvent.setup();
    const openSignIn = vi.fn();
    mockWallet = makeWallet({ signed: false, openSignIn });
    playback.mockResolvedValue(paywall({ price_coins: 45 }));
    render(<Player series={series} n={11} />);
    expect(await screen.findByText(/this one is 45 coins/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Sign in to continue/ }));
    expect(openSignIn).toHaveBeenCalledWith("/watch/ceo-sahab/11");
  });

  it("unlocks a single episode for the server's price and re-asks the server", async () => {
    const user = userEvent.setup();
    const unlockEpisode = vi.fn(async () => ({ ok: true as const, spent: 45 }));
    const toast = vi.fn();
    mockWallet = makeWallet({ signed: true, balance: 2000, unlockEpisode, toast });
    playback
      .mockResolvedValueOnce(paywall({ price_coins: 45, balance: 2000 }))
      .mockResolvedValue(playable(false));
    render(<Player series={series} n={11} />);
    await user.click(await screen.findByRole("button", { name: /Unlock for 45 coins/ }));
    expect(unlockEpisode).toHaveBeenCalledWith("ceo-sahab", 11);
    expect(toast).toHaveBeenCalledWith("Episode 11 unlocked · −45 coins");
    expect(await screen.findByText(/Unlocked episode/)).toBeInTheDocument();
    expect(playback).toHaveBeenCalledTimes(2);
  });

  it("shows the bundle for the server's remaining count and offer, and unlocks all", async () => {
    const user = userEvent.setup();
    const unlockBundle = vi.fn(async () => ({ ok: true as const, spent: 1103 }));
    const toast = vi.fn();
    mockWallet = makeWallet({ signed: true, balance: 5000, unlockBundle, toast });
    playback.mockResolvedValue(paywall({ balance: 5000, remaining_locked: 49, bundle_offer_coins: 1103 }));
    render(<Player series={series} n={11} />);
    const bundleBtn = await screen.findByRole("button", { name: /Unlock all 49 left/ });
    expect(bundleBtn).toHaveTextContent("1,103");
    await user.click(bundleBtn);
    expect(unlockBundle).toHaveBeenCalledWith("ceo-sahab");
    expect(toast).toHaveBeenCalledWith("Unlocked all 49 episodes · −1,103 coins");
  });

  it("blocks the bundle and toasts when the server balance cannot cover the offer", async () => {
    const user = userEvent.setup();
    const unlockBundle = vi.fn();
    const toast = vi.fn();
    mockWallet = makeWallet({ signed: true, balance: 100, unlockBundle, toast });
    playback.mockResolvedValue(paywall({ balance: 100 }));
    render(<Player series={series} n={11} />);
    await user.click(await screen.findByRole("button", { name: /Unlock all .* left/ }));
    expect(toast).toHaveBeenCalledWith("Not enough coins for the full bundle");
    expect(unlockBundle).not.toHaveBeenCalled();
  });

  it("surfaces an insufficient-coins answer and a failed unlock without charging", async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    const unlockEpisode = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "insufficient" })
      .mockResolvedValueOnce({ ok: false, reason: "error" });
    const unlockBundle = vi.fn(async () => ({ ok: false as const, reason: "error" as const }));
    mockWallet = makeWallet({ signed: true, balance: 100, unlockEpisode, unlockBundle, toast });
    playback.mockResolvedValue(paywall({ balance: 100, bundle_offer_coins: 50 }));
    render(<Player series={series} n={11} />);
    await user.click(await screen.findByRole("button", { name: /Unlock for 30 coins/ }));
    expect(toast).toHaveBeenLastCalledWith("Not enough coins — top up to unlock");
    await user.click(await screen.findByRole("button", { name: /Unlock for 30 coins/ }));
    expect(toast).toHaveBeenLastCalledWith("Couldn't confirm the unlock — you weren't charged");
    await user.click(await screen.findByRole("button", { name: /Unlock all/ }));
    expect(toast).toHaveBeenLastCalledWith("Couldn't confirm the bundle — you weren't charged");
  });

  it("a bundle the ledger refuses for funds is reported as such", async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    const unlockBundle = vi.fn(async () => ({ ok: false as const, reason: "insufficient" as const }));
    mockWallet = makeWallet({ signed: true, balance: 100, unlockBundle, toast });
    playback.mockResolvedValue(paywall({ balance: 100, bundle_offer_coins: 50 }));
    render(<Player series={series} n={11} />);
    await user.click(await screen.findByRole("button", { name: /Unlock all/ }));
    expect(toast).toHaveBeenLastCalledWith("Not enough coins for the full bundle");
  });

  it("directs a signed viewer who is short on coins to the coin store", async () => {
    mockWallet = makeWallet({ signed: true, balance: 10 });
    playback.mockResolvedValue(paywall({ balance: 10 }));
    render(<Player series={series} n={11} />);
    expect(await screen.findByText(/you need 20 more/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock for 30" })).toBeDisabled();
  });

  it("hides the bundle button when only one locked episode remains", async () => {
    mockWallet = makeWallet({ signed: true, balance: 5000 });
    playback.mockResolvedValue(paywall({ balance: 5000, remaining_locked: 1, bundle_offer_coins: 23 }));
    render(<Player series={series} n={11} />);
    expect(await screen.findByText("Unlock Episode 11")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Unlock all/ })).not.toBeInTheDocument();
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

describe("fallback branches", () => {
  it("an out-of-range episode number falls back to episode 1's title", async () => {
    playback.mockResolvedValue(playable(true));
    render(<Player series={series} n={9999} />);
    expect(screen.getAllByText(new RegExp(series.episodes[0].title))[0]).toBeInTheDocument();
  });

  it("a signed-in wallet with no name gets the M avatar", () => {
    mockWallet = makeWallet({ signed: true, name: "" });
    render(<SiteHeader />);
    expect(screen.getByLabelText("Profile").textContent).toBe("M");
  });
});


describe("Player — hls.js (MSE) branch", () => {
  const fatal = () => act(() => { hlsState.handlers.forEach((h) => h(null, { fatal: true })); });

  it("loads the server URL through hls.js, reveals on loadeddata, destroys on unmount", async () => {
    hlsState.supported = true;
    playback.mockResolvedValue(playable(true));
    const { unmount } = render(<Player series={series} n={2} />);
    await waitFor(() => expect(hlsState.loadSource).toHaveBeenCalledWith(STREAM));
    expect(hlsState.attachMedia).toHaveBeenCalled();
    const video = document.querySelector("video") as HTMLVideoElement;
    act(() => { video.dispatchEvent(new Event("loadeddata")); });
    expect(video.style.opacity).toBe("1");
    unmount();
    expect(hlsState.destroy).toHaveBeenCalled();
  });

  it("recovers ONCE from a fatal error by re-fetching a fresh playback URL, then surfaces the error", async () => {
    hlsState.supported = true;
    const FRESH = STREAM.replace("master", "fresh");
    playback
      .mockResolvedValueOnce(playable(true))
      .mockResolvedValueOnce({ ...playable(true), hls_master_url: FRESH });
    render(<Player series={series} n={2} />);
    await waitFor(() => expect(hlsState.handlers.length).toBeGreaterThan(0));
    act(() => { hlsState.handlers.forEach((h) => h(null, { fatal: false })); });   // ignored
    fatal();
    await waitFor(() => expect(hlsState.loadSource).toHaveBeenLastCalledWith(FRESH));
    expect(screen.queryByText("Stream unavailable")).not.toBeInTheDocument();
    fatal();                                                                       // second: give up
    expect(await screen.findByText("Stream unavailable")).toBeInTheDocument();
  });

  it("a locked answer or a failed re-fetch during recovery is a stream error", async () => {
    hlsState.supported = true;
    playback.mockResolvedValueOnce(playable(true)).mockResolvedValueOnce(paywall());
    const first = render(<Player series={series} n={2} />);
    await waitFor(() => expect(hlsState.handlers.length).toBe(1));
    fatal();
    expect(await screen.findByText("Stream unavailable")).toBeInTheDocument();
    first.unmount();

    hlsState.handlers = [];
    playback.mockReset();
    playback.mockResolvedValueOnce(playable(true)).mockRejectedValueOnce(new Error("down"));
    render(<Player series={series} n={2} />);
    await waitFor(() => expect(hlsState.handlers.length).toBe(1));
    fatal();
    expect(await screen.findByText("Stream unavailable")).toBeInTheDocument();
  });

  it("a crash inside the media stack is a stream error, not a blank stage", async () => {
    hlsState.importFails = true;
    playback.mockResolvedValue(playable(true));
    render(<Player series={series} n={2} />);
    expect(await screen.findByText("Stream unavailable")).toBeInTheDocument();
  });
});

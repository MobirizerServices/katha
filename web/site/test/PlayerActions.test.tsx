/** Player actions: parental PIN gate, captions, mute, like, remind, end card. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WalletCtx } from "@/components/WalletProvider";
import { getSeries } from "@/lib/catalog";
import { setPin } from "@/lib/parentalLock";
import { getCaptionPref, setCaptionPref } from "@/lib/prefs";
import { makeWallet } from "./walletStub";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: any) =>
    React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const playback = vi.fn();
const reminders = vi.fn();
const addReminder = vi.fn();
const removeReminder = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    playback: (...a: unknown[]) => playback(...a),
    reminders: (...a: unknown[]) => reminders(...a),
    addReminder: (...a: unknown[]) => addReminder(...a),
    removeReminder: (...a: unknown[]) => removeReminder(...a),
  },
}));

const hlsState = {
  supported: false,
  subtitleTracks: [] as { lang?: string; name: string }[],
  instances: [] as { subtitleTrack: number; subtitleDisplay: boolean }[],
};
vi.mock("hls.js", () => {
  class FakeHls {
    static isSupported() { return hlsState.supported; }
    static Events = { ERROR: "hlsError" };
    subtitleTracks = hlsState.subtitleTracks;
    subtitleTrack = -1;
    subtitleDisplay = false;
    constructor() { hlsState.instances.push(this); }
    loadSource() {}
    attachMedia() {}
    on() {}
    destroy() {}
  }
  return { default: FakeHls };
});

let mockWallet: WalletCtx;
vi.mock("@/components/WalletProvider", () => ({ useWallet: () => mockWallet }));

import Player from "@/components/Player";

const teen = getSeries("ceo-sahab")!;            // U/A 13+: never gated
const adult = getSeries("dilli-6-ka-raaz")!;     // U/A 16+: gated when a PIN is set
const STREAM = "http://127.0.0.1:8799/media/x/hls/master.m3u8";
const CAPS = [
  { lang: "en", label: "English", url: "http://127.0.0.1:8799/media/x/subs/en.vtt" },
  { lang: "hi", label: "Hindi", url: "http://127.0.0.1:8799/media/x/subs/hi.vtt" },
];
const playable = (captions = CAPS) => ({ locked: false, episode_id: "x", free: true, hls_master_url: STREAM, captions });

/** jsdom has no TextTrackList; install a fake one so the caption effect has tracks to switch. */
function fakeTextTracks(langs: string[]) {
  const tracks = langs.map((language) => ({ language, mode: "disabled" }));
  Object.defineProperty(HTMLMediaElement.prototype, "textTracks", { configurable: true, get: () => tracks });
  return tracks;
}

async function revealVideo() {
  const video = (await waitFor(() => {
    const v = document.querySelector("video");
    expect(v).not.toBeNull();
    return v;
  })) as HTMLVideoElement;
  await waitFor(() => expect(video.src || hlsState.instances.length).toBeTruthy());
  act(() => { video.dispatchEvent(new Event("loadeddata")); });
  return video;
}

beforeEach(() => {
  push.mockClear();
  playback.mockReset().mockResolvedValue(playable());
  reminders.mockReset().mockResolvedValue({ slugs: [] });
  addReminder.mockReset();
  removeReminder.mockReset();
  hlsState.supported = false;
  hlsState.subtitleTracks = [];
  hlsState.instances = [];
  mockWallet = makeWallet();
  expect(adult.rating).toBe("U/A 16+");
  vi.spyOn(window.HTMLMediaElement.prototype, "canPlayType").mockReturnValue("maybe");
  fakeTextTracks([]);
});

describe("parental PIN gate", () => {
  it("a gated series with a PIN set is not even asked of the server until the PIN clears", async () => {
    const user = userEvent.setup();
    await setPin("1234");
    render(<Player series={adult} n={1} />);
    expect(await screen.findByRole("form", { name: "Parental lock" })).toBeInTheDocument();
    expect(playback).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Parental PIN"), "0000");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/didn't match/);
    expect(playback).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Parental PIN"), "1234");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(playback).toHaveBeenCalledWith("dilli-6-ka-raaz", 1));
    expect(screen.queryByRole("form", { name: "Parental lock" })).not.toBeInTheDocument();
    expect(await screen.findByText(/Free episode 1/)).toBeInTheDocument();
  });

  it("without a PIN a 16+ series plays straight away; a 13+ series ignores the PIN", async () => {
    render(<Player series={adult} n={1} />);
    expect(await screen.findByText(/Free episode 1/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Parental lock" })).not.toBeInTheDocument();
    await setPin("1234");
    render(<Player series={teen} n={2} />);
    expect(await screen.findByText(/Free episode 2/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Parental lock" })).not.toBeInTheDocument();
  });
});

describe("captions", () => {
  it("offers Off + the payload's captions, cycles through them, applies to <track>s and remembers the choice", async () => {
    const user = userEvent.setup();
    const tracks = fakeTextTracks(["en", "hi"]);
    render(<Player series={teen} n={2} />);
    await revealVideo();
    expect(document.querySelectorAll("track")).toHaveLength(2);
    expect(document.querySelector("track[srclang=en]")).toHaveAttribute("src", CAPS[0].url);
    const cc = screen.getByRole("button", { name: "Captions: Off" });
    expect(tracks.map((t) => t.mode)).toEqual(["hidden", "hidden"]);
    await user.click(cc);
    expect(screen.getByRole("button", { name: "Captions: English" })).toBeInTheDocument();
    expect(tracks.map((t) => t.mode)).toEqual(["showing", "hidden"]);
    expect(getCaptionPref()).toBe("en");
    await user.click(screen.getByRole("button", { name: "Captions: English" }));
    expect(tracks.map((t) => t.mode)).toEqual(["hidden", "showing"]);
    await user.click(screen.getByRole("button", { name: "Captions: Hindi" }));
    expect(screen.getByRole("button", { name: "Captions: Off" })).toBeInTheDocument();
    expect(getCaptionPref()).toBe("off");
  });

  it("starts from the remembered language, and hides the CC button when nothing offers captions", async () => {
    setCaptionPref("hi");
    const first = render(<Player series={teen} n={2} />);
    await revealVideo();
    expect(screen.getByRole("button", { name: "Captions: Hindi" })).toBeInTheDocument();
    first.unmount();

    playback.mockResolvedValue({ locked: false, episode_id: "x", free: true, hls_master_url: STREAM });   // no captions field at all
    render(<Player series={teen} n={2} />);
    await revealVideo();
    expect(screen.queryByRole("button", { name: /Captions/ })).not.toBeInTheDocument();
  });

  it("merges hls.js subtitle renditions into the menu and drives hls.subtitleTrack", async () => {
    const user = userEvent.setup();
    hlsState.supported = true;
    hlsState.subtitleTracks = [{ lang: "en", name: "English" }, { name: "Tamil" }];   // one without a lang code
    playback.mockResolvedValue(playable([CAPS[0]]));
    render(<Player series={teen} n={2} />);
    await revealVideo();
    const inst = hlsState.instances[0];
    await waitFor(() => expect(screen.getByRole("button", { name: "Captions: Off" })).toBeInTheDocument());
    expect(inst.subtitleTrack).toBe(-1);
    expect(inst.subtitleDisplay).toBe(false);
    await user.click(screen.getByRole("button", { name: "Captions: Off" }));      // -> en (payload + hls, deduped)
    expect(inst.subtitleTrack).toBe(0);
    expect(inst.subtitleDisplay).toBe(true);
    await user.click(screen.getByRole("button", { name: "Captions: English" }));  // -> Tamil (hls only)
    expect(screen.getByRole("button", { name: "Captions: Tamil" })).toBeInTheDocument();
    expect(inst.subtitleTrack).toBe(1);
    await user.click(screen.getByRole("button", { name: "Captions: Tamil" }));    // -> off
    expect(inst.subtitleTrack).toBe(-1);
  });
});

describe("mute, like", () => {
  it("starts muted (autoplay), toggles the element, and the heart is local state only", async () => {
    const user = userEvent.setup();
    render(<Player series={teen} n={2} />);
    const video = await revealVideo();
    expect(video.muted).toBe(true);
    await user.click(screen.getByRole("button", { name: "Unmute" }));
    expect(video.muted).toBe(false);
    await user.click(screen.getByRole("button", { name: "Mute" }));
    expect(video.muted).toBe(true);

    const like = screen.getByRole("button", { name: "Like" });
    expect(like).toHaveAttribute("aria-pressed", "false");
    await user.click(like);
    expect(screen.getByRole("button", { name: "Unlike" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Unlike" }));
    expect(screen.getByRole("button", { name: "Like" })).toBeInTheDocument();
  });
});

describe("remind me", () => {
  it("a guest is sent to sign in and nothing is fetched", async () => {
    const user = userEvent.setup();
    const openSignIn = vi.fn();
    mockWallet = makeWallet({ signed: false, openSignIn });
    render(<Player series={teen} n={2} />);
    await revealVideo();
    await user.click(screen.getByRole("button", { name: "Remind me" }));
    expect(openSignIn).toHaveBeenCalledWith("/watch/ceo-sahab/2");
    expect(reminders).not.toHaveBeenCalled();
    expect(addReminder).not.toHaveBeenCalled();
  });

  it("a member's bell reflects the server, PUTs then DELETEs, and reports a failure", async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    mockWallet = makeWallet({ signed: true, toast });
    reminders.mockResolvedValue({ slugs: ["ceo-sahab"] });
    removeReminder.mockResolvedValueOnce({ slugs: [] });
    addReminder.mockResolvedValueOnce({ slugs: ["ceo-sahab"] }).mockRejectedValueOnce(new Error("down"));
    render(<Player series={teen} n={2} />);
    await revealVideo();
    await user.click(await screen.findByRole("button", { name: "Stop reminders" }));
    expect(removeReminder).toHaveBeenCalledWith("ceo-sahab");
    expect(await screen.findByRole("button", { name: "Remind me" })).toBeInTheDocument();
    expect(toast).toHaveBeenLastCalledWith("Reminder off");
    await user.click(screen.getByRole("button", { name: "Remind me" }));
    expect(addReminder).toHaveBeenCalledWith("ceo-sahab");
    expect(await screen.findByRole("button", { name: "Stop reminders" })).toBeInTheDocument();
    expect(toast).toHaveBeenLastCalledWith("We'll tell you when CEO Sahab drops a new episode");
    // fail the next add
    removeReminder.mockResolvedValueOnce({ slugs: [] });
    await user.click(screen.getByRole("button", { name: "Stop reminders" }));
    await screen.findByRole("button", { name: "Remind me" });
    await user.click(screen.getByRole("button", { name: "Remind me" }));
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith("Couldn't save the reminder — try again"));
  });

  it("a failed reminders read leaves the bell off", async () => {
    mockWallet = makeWallet({ signed: true });
    reminders.mockRejectedValue(new Error("down"));
    render(<Player series={teen} n={2} />);
    await revealVideo();
    expect(screen.getByRole("button", { name: "Remind me" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("native HLS (Safari) error path", () => {
  it("a media error on the element is a stream error", async () => {
    render(<Player series={teen} n={2} />);
    const video = await revealVideo();
    fireEvent(video, new Event("error"));
    expect(await screen.findByText("Stream unavailable")).toBeInTheDocument();
  });
});

describe("end of episode", () => {
  it("the ended event shows the card; Play E(n+1) routes on (the server decides there); Replay restarts", async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(window.HTMLMediaElement.prototype, "play")
      .mockImplementationOnce(() => Promise.reject(new Error("autoplay refused")))
      .mockImplementationOnce(() => undefined as unknown as Promise<void>);
    render(<Player series={teen} n={3} />);
    const video = await revealVideo();
    expect(screen.queryByText("Episode 3 finished")).not.toBeInTheDocument();
    fireEvent(video, new Event("ended"));
    expect(screen.getByText("Episode 3 finished")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Next: E4 · ${teen.episodes[3].title}`))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replay" }));
    expect(screen.queryByText("Episode 3 finished")).not.toBeInTheDocument();
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBe(0);
    fireEvent(video, new Event("ended"));
    await user.click(screen.getByRole("button", { name: "Replay" }));      // play() without a promise
    expect(play).toHaveBeenCalledTimes(2);
    fireEvent(video, new Event("ended"));
    await user.click(screen.getByRole("button", { name: "Play E4" }));
    expect(push).toHaveBeenCalledWith("/watch/ceo-sahab/4");
    play.mockRestore();
  });

  it("the last episode offers no next, only replay and the way back", async () => {
    const last = teen.episodeCount;
    render(<Player series={teen} n={last} />);
    const video = await revealVideo();
    fireEvent(video, new Event("ended"));
    expect(screen.getByText(`That was the last episode of ${teen.title}.`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Play E/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the series" })).toHaveAttribute("href", "/series/ceo-sahab");
  });

  it("a next episode the seed has no title for still gets a Play button", async () => {
    const trimmed = { ...teen, episodes: teen.episodes.slice(0, 3) };   // n=3 -> no episode 4 row, but episodeCount says more
    render(<Player series={trimmed} n={3} />);
    const video = await revealVideo();
    fireEvent(video, new Event("ended"));
    expect(screen.getByText("Next: E4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play E4" })).toBeInTheDocument();
  });
});

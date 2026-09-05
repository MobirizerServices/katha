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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/watch/x/1" }));

const playback = vi.fn();
const reminders = vi.fn();
const addReminder = vi.fn();
const removeReminder = vi.fn();
const seriesDetail = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    playback: (...a: unknown[]) => playback(...a),
    reminders: (...a: unknown[]) => reminders(...a),
    addReminder: (...a: unknown[]) => addReminder(...a),
    removeReminder: (...a: unknown[]) => removeReminder(...a),
    series: (...a: unknown[]) => seriesDetail(...a),
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

/** jsdom has no TextTrackList; install a fake one so the caption effect has
 * tracks to switch, cues to read and a cuechange event to listen for. */
type FakeTrack = {
  language: string;
  mode: string;
  activeCues: { text: string }[] | null;
  listeners: (() => void)[];
  addEventListener(e: string, fn: () => void): void;
  removeEventListener(e: string, fn: () => void): void;
  /** Play a cue: what the browser does as the video crosses a cue boundary. */
  show(...texts: string[]): void;
};
function fakeTextTracks(langs: string[]): FakeTrack[] {
  const tracks: FakeTrack[] = langs.map((language) => {
    const t: FakeTrack = {
      language,
      mode: "disabled",
      activeCues: null,
      listeners: [],
      addEventListener(_e, fn) { t.listeners.push(fn); },
      removeEventListener(_e, fn) { t.listeners = t.listeners.filter((l) => l !== fn); },
      show(...texts) {
        t.activeCues = texts.map((text) => ({ text }));
        act(() => { t.listeners.forEach((l) => l()); });
      },
    };
    return t;
  });
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
  // By default the catalog service agrees with the seed.
  seriesDetail.mockReset().mockImplementation((slug: string) =>
    Promise.resolve({ slug, content_rating: slug === "dilli-6-ka-raaz" ? "U/A 16+" : "U/A 13+" })
  );
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

  it("gates on the SERVER's rating, not the seed's: a re-rated 13+ title locks", async () => {
    // The catalog service now rates ceo-sahab 16+ while the bundled seed still
    // says 13+. The gate — and the gate's wording — follow the server.
    await setPin("1234");
    seriesDetail.mockResolvedValue({ slug: "ceo-sahab", content_rating: "U/A 16+" });
    render(<Player series={teen} n={2} />);
    expect(await screen.findByRole("form", { name: "Parental lock" })).toBeInTheDocument();
    expect(screen.getByText(/rated U\/A 16\+/)).toBeInTheDocument();
    expect(playback).not.toHaveBeenCalled();
  });

  it("a title the server has downgraded to 13+ stops being gated", async () => {
    await setPin("1234");
    seriesDetail.mockResolvedValue({ slug: "dilli-6-ka-raaz", content_rating: "U/A 13+" });
    render(<Player series={adult} n={1} />);
    expect(await screen.findByText(/Free episode 1/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Parental lock" })).not.toBeInTheDocument();
  });

  it("an unreachable catalog service fails CLOSED while a PIN is set, and open without one", async () => {
    seriesDetail.mockRejectedValue(new Error("catalog down"));
    await setPin("1234");
    const gated = render(<Player series={teen} n={2} />);
    expect(await screen.findByRole("form", { name: "Parental lock" })).toBeInTheDocument();
    expect(playback).not.toHaveBeenCalled();
    gated.unmount();

    localStorage.clear();
    render(<Player series={teen} n={2} />);
    expect(await screen.findByText(/Free episode 2/)).toBeInTheDocument();
  });

  it("a rating answer with no rating at all falls back to the seed value", async () => {
    await setPin("1234");
    seriesDetail.mockResolvedValue({ slug: "dilli-6-ka-raaz", content_rating: "" });
    render(<Player series={adult} n={1} />);          // seed says 16+
    expect(await screen.findByRole("form", { name: "Parental lock" })).toBeInTheDocument();
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
    // Nothing is ever left "showing": native cues would paint over the seek bar.
    expect(tracks.map((t) => t.mode)).toEqual(["disabled", "disabled"]);
    await user.click(cc);
    expect(screen.getByRole("button", { name: "Captions: English" })).toBeInTheDocument();
    expect(tracks.map((t) => t.mode)).toEqual(["hidden", "disabled"]);
    expect(getCaptionPref()).toBe("en");
    await user.click(screen.getByRole("button", { name: "Captions: English" }));
    expect(tracks.map((t) => t.mode)).toEqual(["disabled", "hidden"]);
    await user.click(screen.getByRole("button", { name: "Captions: Hindi" }));
    expect(screen.getByRole("button", { name: "Captions: Off" })).toBeInTheDocument();
    expect(getCaptionPref()).toBe("off");
  });

  it("draws the active cues into .subt — above the controls, never over them", async () => {
    const user = userEvent.setup();
    const tracks = fakeTextTracks(["en", "hi"]);
    render(<Player series={teen} n={2} />);
    await revealVideo();
    await user.click(screen.getByRole("button", { name: "Captions: Off" }));   // -> English
    expect(document.querySelector(".subt")).toBeNull();
    tracks[0].show("He is at the door.");
    const subt = document.querySelector(".subt") as HTMLElement;
    expect(subt).toHaveTextContent("He is at the door.");
    // .subt sits inside the stage, before .pbottom — it cannot cover the bar
    expect(subt.parentElement?.querySelector(".pbottom")).not.toBeNull();
    tracks[0].show("Two lines", "at once");
    expect(document.querySelector(".subt")?.textContent).toBe("Two linesat once");
    tracks[0].show();                                    // cue window passed
    expect(document.querySelector(".subt")).toBeNull();
    // switching the language clears whatever the old track was showing
    tracks[0].show("still here");
    await user.click(screen.getByRole("button", { name: "Captions: English" }));
    expect(document.querySelector(".subt")).toBeNull();
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
    // hls.js never paints them either — the rendition is selected, we draw it
    expect(inst.subtitleDisplay).toBe(false);
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

describe("transport — the seek bar and the counter are the element's own state", () => {
  /** Put the element at a real position/duration and fire the event that
   * carries it, exactly as the media stack would. */
  function at(video: HTMLVideoElement, currentTime: number, duration: number, paused = false) {
    Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: currentTime });
    Object.defineProperty(video, "duration", { configurable: true, writable: true, value: duration });
    Object.defineProperty(video, "paused", { configurable: true, writable: true, value: paused });
    act(() => { video.dispatchEvent(new Event("timeupdate")); });
  }

  it("shows the real position and duration, and fills the bar to match", async () => {
    render(<Player series={teen} n={2} />);
    const video = await revealVideo();
    at(video, 7.4, 301.08);
    expect(screen.getByText("0:07 / 5:01")).toBeInTheDocument();
    const bar = screen.getByRole("slider", { name: "Seek" });
    expect((bar.firstElementChild as HTMLElement).style.width).toMatch(/^2\.4/);
    expect(bar).toHaveAttribute("aria-valuenow", "7");
    expect(bar).toHaveAttribute("aria-valuemax", "301");
    expect(bar).toHaveAttribute("aria-valuetext", "0:07 of 5:01");
    at(video, 150.54, 301.08);
    expect(screen.getByText("2:30 / 5:01")).toBeInTheDocument();
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("50%");
  });

  it("reads 0:00 / 0:00 while the duration is still unknown", async () => {
    render(<Player series={teen} n={2} />);
    const video = await revealVideo();
    at(video, 0, NaN);
    expect(screen.getByText("0:00 / 0:00")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Seek" }).firstElementChild)
      .toHaveStyle({ width: "0%" });
  });

  it("play / pause drives the element and the button says which", async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    render(<Player series={teen} n={2} />);
    const video = await revealVideo();
    at(video, 4, 100, false);
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(pause).toHaveBeenCalled();
    const playBtn = await screen.findByRole("button", { name: "Play" });
    Object.defineProperty(video, "paused", { configurable: true, writable: true, value: true });
    await user.click(playBtn);
    expect(play).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
    play.mockRestore();
    pause.mockRestore();
  });

  it("a refused play() leaves the button saying Play", async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(window.HTMLMediaElement.prototype, "play")
      .mockRejectedValue(new Error("autoplay refused"));
    render(<Player series={teen} n={2} />);
    const video = await revealVideo();
    at(video, 0, 100, true);
    await user.click(await screen.findByRole("button", { name: "Play" }));
    expect(await screen.findByRole("button", { name: "Play" })).toBeInTheDocument();
    play.mockRestore();
  });

  it("play() without a promise (older engines) still toggles", async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(window.HTMLMediaElement.prototype, "play")
      .mockImplementation(() => undefined as unknown as Promise<void>);
    render(<Player series={teen} n={2} />);
    const video = await revealVideo();
    at(video, 0, 100, true);
    await user.click(await screen.findByRole("button", { name: "Play" }));
    expect(play).toHaveBeenCalled();
    play.mockRestore();
  });

  /** jsdom has no PointerEvent: dispatch a plain event carrying the fields
   * React reads off the native one. */
  function pointer(el: HTMLElement, type: string, clientX: number, buttons: number) {
    const ev = new Event(type, { bubbles: true }) as Event & { clientX: number; buttons: number; pointerId: number };
    ev.clientX = clientX;
    ev.buttons = buttons;
    ev.pointerId = 1;
    act(() => { el.dispatchEvent(ev); });
  }

  it("clicking the bar seeks there; a bar with no width (or no duration) is inert", async () => {
    render(<Player series={teen} n={2} />);
    const video = await revealVideo();
    at(video, 10, 200);
    const bar = screen.getByRole("slider", { name: "Seek" });
    // jsdom lays nothing out: give the bar a box so a click has a fraction
    const rect = vi.spyOn(bar, "getBoundingClientRect")
      .mockReturnValue({ left: 100, width: 400, right: 500, top: 0, bottom: 4, height: 4, x: 100, y: 0, toJSON: () => ({}) } as DOMRect);
    pointer(bar, "pointerdown", 300, 1);
    expect(video.currentTime).toBe(100);                       // half way
    pointer(bar, "pointermove", 200, 1);                       // dragging
    expect(video.currentTime).toBe(50);
    pointer(bar, "pointermove", 400, 0);                       // not dragging
    expect(video.currentTime).toBe(50);
    rect.mockReturnValue({ left: 0, width: 0, right: 0, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    pointer(bar, "pointerdown", 10, 1);
    expect(video.currentTime).toBe(50);                        // unlaid-out bar: no jump
    rect.mockRestore();
  });

  it("the bar is keyboard-operable and clamps at both ends", async () => {
    render(<Player series={teen} n={2} />);
    const video = await revealVideo();
    at(video, 100, 200);
    const bar = screen.getByRole("slider", { name: "Seek" });
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(video.currentTime).toBe(105);
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    expect(video.currentTime).toBe(100);
    fireEvent.keyDown(bar, { key: "PageUp" });
    expect(video.currentTime).toBe(130);
    fireEvent.keyDown(bar, { key: "PageDown" });
    expect(video.currentTime).toBe(100);
    fireEvent.keyDown(bar, { key: "End" });
    expect(video.currentTime).toBe(200);
    fireEvent.keyDown(bar, { key: "Home" });
    expect(video.currentTime).toBe(0);
    fireEvent.keyDown(bar, { key: "ArrowLeft" });               // clamped at 0
    expect(video.currentTime).toBe(0);
    fireEvent.keyDown(bar, { key: "a" });                       // not a seek key
    expect(video.currentTime).toBe(0);
  });

  it("a seek before any duration is known does nothing", async () => {
    render(<Player series={teen} n={2} />);
    const video = await revealVideo();
    at(video, 0, NaN);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Seek" }), { key: "ArrowRight" });
    expect(video.currentTime).toBe(0);
  });
});

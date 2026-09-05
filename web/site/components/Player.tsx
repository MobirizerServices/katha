"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "./WalletProvider";
import PinGate from "./PinGate";
import { api, type CaptionDTO } from "@/lib/api";
import { Series, clock, fmt } from "@/lib/catalog";
import { isPinSet, needsPin } from "@/lib/parentalLock";
import { CAPTIONS_OFF, getCaptionPref, setCaptionPref } from "@/lib/prefs";

/**
 * The server decides. Every render of this page starts with the playback
 * endpoint: it answers either with a signed stream (entitled — free or
 * unlocked) or with the paywall and every number the paywall shows (price,
 * balance, how many episodes are left, the exact bundle offer). Nothing here
 * computes a price or remembers an unlock.
 *
 * The one local gate is the parental PIN: a U/A 16+ or A series behind a set
 * PIN is not even asked of the server until the PIN clears. The rating that
 * gate keys off is the CATALOG SERVICE's (/v1/series/{slug}), never the seed
 * baked into this bundle — a title re-rated in the back office must lock the
 * moment the server says so.
 */
type Access =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "play"; url: string; free: boolean; captions: CaptionDTO[] }
  | { kind: "locked"; price: number; balance: number; remaining: number; bundle: number };

/** The slice of hls.js the player drives (narrow so tests can fake it). */
interface HlsLike {
  destroy(): void;
  loadSource(url: string): void;
  attachMedia(video: HTMLVideoElement): void;
  on(evt: string, handler: (evt: unknown, data: { fatal: boolean }) => void): void;
  subtitleTracks: { lang?: string; name: string }[];
  subtitleTrack: number;
  subtitleDisplay: boolean;
}

type CaptionOption = { lang: string; label: string };

/**
 * Player chrome, drawn rather than typed: a glyph set mixing "♡", the letters
 * "CC" and colour emoji renders at a different weight — and sometimes a
 * different colour — on every OS. These are one stroke weight, currentColor,
 * and identical everywhere.
 */
const svg = (d: ReactNode, filled = false) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"
       fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

const Icon = {
  Back: () => svg(<path d="M15 5 8 12l7 7" />),
  Heart: ({ filled }: { filled: boolean }) =>
    svg(<path d="M12 20s-7-4.35-7-9.5A3.9 3.9 0 0 1 12 7.6 3.9 3.9 0 0 1 19 10.5c0 5.15-7 9.5-7 9.5Z" />, filled),
  Captions: () => (
    <svg viewBox="0 0 24 24" width="22" height="16" aria-hidden="true" focusable="false"
         fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="4.5" width="19" height="15" rx="3" />
      <path d="M10 10.2a2.6 2.6 0 1 0 0 3.6M17.5 10.2a2.6 2.6 0 1 0 0 3.6" />
    </svg>
  ),
  SpeakerOn: () => svg(<><path d="M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4z" /><path d="M16 9a4.2 4.2 0 0 1 0 6" /><path d="M18.6 6.6a7.8 7.8 0 0 1 0 10.8" /></>),
  SpeakerOff: () => svg(<><path d="M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4z" /><path d="m16.5 9.8 4 4.4M20.5 9.8l-4 4.4" /></>),
  Bell: ({ ringing }: { ringing: boolean }) =>
    svg(
      <>
        <path d="M6.5 16V10.8a5.5 5.5 0 1 1 11 0V16l1.6 2.2H4.9z" />
        <path d="M10.2 19.6a2 2 0 0 0 3.6 0" />
        {!ringing && <path d="M4.4 4.4 19.6 19.6" />}
      </>
    ),
  Prev: () => svg(<><path d="M18.5 6v12L10 12z" /><path d="M6.5 6v12" /></>),
  Next: () => svg(<><path d="M5.5 6v12L14 12z" /><path d="M17.5 6v12" /></>),
  Play: () => svg(<path d="M7.5 5.5 18.5 12l-11 6.5z" />, true),
  Pause: () => svg(<><path d="M9 5.5v13" /><path d="M15 5.5v13" /></>),
};

export default function Player({ series, n }: { series: Series; n: number }) {
  const w = useWallet();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<HlsLike | null>(null);
  const [access, setAccess] = useState<Access>({ kind: "loading" });
  const [videoOk, setVideoOk] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [busy, setBusy] = useState<"episode" | "bundle" | null>(null);
  // Parental lock: unknown until mounted (localStorage), then locked or open.
  const [gate, setGate] = useState<"unknown" | "locked" | "open">("unknown");
  // Player actions.
  const [captionLang, setCaptionLang] = useState<string | null>(null);
  const [hlsSubs, setHlsSubs] = useState<CaptionOption[]>([]);
  const [muted, setMuted] = useState(true);
  const [liked, setLiked] = useState(false); // local heart only — there is no like endpoint yet
  const [remind, setRemind] = useState(false);
  const [ended, setEnded] = useState(false);
  const [cueText, setCueText] = useState("");
  // Transport: mirrored from the element's own events — never a decorative guess.
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [paused, setPaused] = useState(false);
  // The live rating from the catalog service (null until it answers).
  const [rating, setRating] = useState<string | null>(null);

  const ep = series.episodes.find((e) => e.number === n) || series.episodes[0];
  // "Episode 12" is the seed's stand-in for an untitled episode; the header
  // already reads "E12", so it is not repeated as a title.
  const epTitle = ep.title === `Episode ${ep.number}` ? "" : ep.title;
  const nextEp = series.episodes.find((e) => e.number === n + 1);
  const hasNext = n < series.episodeCount;
  const here = `/watch/${series.slug}/${n}`;

  // 0. Is this series behind the parental PIN on this browser? The rating is
  //    the server's. Until it answers nothing is asked of playback, and if it
  //    never answers the gate closes rather than opens: an unknown rating with
  //    a PIN set is treated as gated (the PIN holder can still pass, and the
  //    playback call would fail against the same unreachable server anyway).
  useEffect(() => {
    setCaptionLang(getCaptionPref());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setGate("unknown");
    setRating(null);
    api
      .series(series.slug)
      .then((s) => {
        if (cancelled) return;
        const live = s.content_rating || series.rating;
        setRating(live);
        setGate(needsPin(live) && isPinSet() ? "locked" : "open");
      })
      .catch(() => {
        if (cancelled) return;
        setRating(series.rating);
        setGate(isPinSet() ? "locked" : "open");
      });
    return () => {
      cancelled = true;
    };
  }, [series.slug, series.rating]);

  // 1. Ask the server whether this viewer may watch this episode. Re-asked
  //    whenever identity or the wallet changes (sign-in, purchase, unlock).
  useEffect(() => {
    if (!w.ready || gate !== "open") return;
    let cancelled = false;
    setAccess({ kind: "loading" });
    setVideoOk(false);
    setEnded(false);
    api
      .playback(series.slug, n)
      .then((pb) => {
        if (cancelled) return;
        if (pb.locked) {
          setAccess({
            kind: "locked",
            price: pb.price_coins,
            balance: pb.balance,
            remaining: pb.remaining_locked,
            bundle: pb.bundle_offer_coins,
          });
        } else if (pb.hls_master_url) {
          setAccess({ kind: "play", url: pb.hls_master_url, free: pb.free, captions: pb.captions ?? [] });
        } else {
          setAccess({ kind: "error" });
        }
      })
      .catch(() => !cancelled && setAccess({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, [series.slug, n, w.ready, w.signed, w.balance, retryKey, gate]);

  // 1b. Is a "new episode" reminder set for this series? Members only.
  useEffect(() => {
    if (!w.ready || !w.signed) return;
    let cancelled = false;
    api
      .reminders()
      .then((r) => !cancelled && setRemind(r.slugs.includes(series.slug)))
      .catch(() => !cancelled && setRemind(false));
    return () => {
      cancelled = true;
    };
  }, [series.slug, w.ready, w.signed]);

  // 2. Attach hls.js only once the server has handed us a stream.
  const src = access.kind === "play" ? access.url : null;
  const playing = access.kind === "play";
  useEffect(() => {
    if (!src) return;
    const video = videoRef.current;
    if (!video) return;
    let hls: HlsLike | null = null;
    let cancelled = false;

    setStreamError(false);
    setHlsSubs([]);
    (async () => {
      try {
        const reveal = () => !cancelled && setVideoOk(true);
        // Prefer hls.js wherever MSE exists: Chrome answers "maybe" to the
        // native canPlayType probe but cannot actually demux HLS.
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (cancelled) return;
        if (Hls.isSupported()) {
          const inst = new Hls({ maxBufferLength: 10 }) as unknown as HlsLike;
          hls = inst;
          hlsRef.current = inst;
          inst.loadSource(src);
          inst.attachMedia(video);
          // Reveal on real frames (not MANIFEST_PARSED): if the media stack
          // can't open MSE the gradient poster simply stays.
          video.addEventListener(
            "loadeddata",
            () => {
              reveal();
              // Subtitle renditions inside the HLS manifest join the CC menu.
              if (!cancelled)
                setHlsSubs(inst.subtitleTracks.map((t) => ({ lang: t.lang ?? t.name, label: t.name })));
            },
            { once: true }
          );
          // Signed stream tokens expire mid-play: on the first fatal error,
          // re-fetch a fresh playback URL once; after that, surface the error.
          let recovered = false;
          inst.on(Hls.Events.ERROR, (_evt: unknown, data: { fatal: boolean }) => {
            if (cancelled || !data.fatal) return;
            if (recovered) {
              setStreamError(true);
              return;
            }
            recovered = true;
            api
              .playback(series.slug, n)
              .then((fresh) => {
                if (cancelled) return;
                if (!fresh.locked && fresh.hls_master_url) inst.loadSource(fresh.hls_master_url);
                else setStreamError(true);
              })
              .catch(() => !cancelled && setStreamError(true));
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = src;                       // Safari: native HLS
          video.addEventListener("loadeddata", reveal, { once: true });
          video.addEventListener("error", () => !cancelled && setStreamError(true), { once: true });
        }
      } catch {
        if (!cancelled) setStreamError(true);
      }
    })();

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      hlsRef.current = null;
    };
  }, [src, series.slug, n]);

  // 2b. Transport: position, duration and play state come from the element's
  //     own events, so the seek bar and the counter are the real thing.
  useEffect(() => {
    if (!playing) return;
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setCur(video.currentTime || 0);
      setDur(Number.isFinite(video.duration) ? video.duration : 0);
      setPaused(video.paused);
    };
    sync();
    const events = ["timeupdate", "durationchange", "loadedmetadata", "play", "pause", "seeked", "emptied"];
    for (const e of events) video.addEventListener(e, sync);
    return () => {
      for (const e of events) video.removeEventListener(e, sync);
    };
  }, [playing, src]);

  // 3. Apply the caption choice to whatever is rendering text: the <track>
  //    elements from the playback payload and/or hls.js subtitle renditions.
  //    No track is ever left "showing": the browser paints native cues at the
  //    bottom edge, on top of the seek bar and the controls. The chosen track
  //    is kept "hidden" — still parsed, still firing cuechange — and its active
  //    cues are drawn into .subt, which sits above the control bar.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoOk) return;
    const want = captionLang ?? CAPTIONS_OFF;
    const tracks = video.textTracks;
    let active: TextTrack | null = null;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const wanted = t.language === want;
      t.mode = wanted ? "hidden" : "disabled";
      if (wanted) active = t;
    }
    const hls = hlsRef.current;
    if (hls) {
      const idx = hls.subtitleTracks.findIndex((t) => (t.lang ?? t.name) === want);
      hls.subtitleTrack = idx;
      hls.subtitleDisplay = false;   // we render the cues ourselves
    }
    setCueText("");
    if (!active) return;
    const track = active;
    const onCueChange = () => {
      const cues = track.activeCues;
      const lines: string[] = [];
      for (let i = 0; cues && i < cues.length; i++) {
        const text = (cues[i] as VTTCue).text;
        if (text) lines.push(text);
      }
      setCueText(lines.join("\n"));
    };
    onCueChange();
    track.addEventListener?.("cuechange", onCueChange);
    return () => track.removeEventListener?.("cuechange", onCueChange);
  }, [captionLang, videoOk, hlsSubs]);

  const goto = (num: number) => router.push(`/watch/${series.slug}/${num}`);
  const locked = access.kind === "locked" ? access : null;
  const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;

  // Caption options: Off, then every language the payload or the manifest offers (deduped).
  const captionOptions: CaptionOption[] = [{ lang: CAPTIONS_OFF, label: "Off" }];
  if (playing) {
    for (const c of [...access.captions, ...hlsSubs])
      if (!captionOptions.some((o) => o.lang === c.lang)) captionOptions.push({ lang: c.lang, label: c.label });
  }
  const currentCaption = captionOptions.find((o) => o.lang === captionLang) ?? captionOptions[0];
  const cycleCaptions = () => {
    const i = captionOptions.indexOf(currentCaption);
    const next = captionOptions[(i + 1) % captionOptions.length].lang;
    setCaptionLang(next);
    setCaptionPref(next);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
  };

  const toggleRemind = () => {
    if (!w.signed) {
      w.openSignIn(here);
      return;
    }
    (remind ? api.removeReminder(series.slug) : api.addReminder(series.slug))
      .then((r) => {
        setRemind(r.slugs.includes(series.slug));
        w.toast(remind ? "Reminder off" : `We'll tell you when ${series.title} drops a new episode`);
      })
      .catch(() => w.toast("Couldn't save the reminder — try again"));
  };

  const replay = () => {
    setEnded(false);
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    const p = video.play();
    if (p) p.catch(() => { /* autoplay refused: the viewer taps play */ });
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setEnded(false);
      setPaused(false);
      const p = video.play();
      if (p) p.catch(() => setPaused(true));   // refused: the button says Play again
    } else {
      video.pause();
      setPaused(true);
    }
  };

  /** Move the playhead. Clamped to the known duration; a no-op before one. */
  const seekTo = (seconds: number) => {
    const video = videoRef.current;
    if (!video || !(dur > 0)) return;
    const t = Math.max(0, Math.min(dur, seconds));
    video.currentTime = t;
    setCur(t);
  };

  /** Click / drag anywhere on the bar. jsdom (and a not-yet-laid-out bar)
   * report a zero width — treated as "no bar to hit", never a divide by zero. */
  const seekFromPointer = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0)) return;
    seekTo(((clientX - r.left) / r.width) * dur);
  };

  const unlockOne = async () => {
    if (!locked || busy) return;
    setBusy("episode");
    const r = await w.unlockEpisode(series.slug, n);
    setBusy(null);
    if (r.ok) w.toast(`Episode ${n} unlocked · −${fmt(r.spent)} coins`);
    else if (r.reason === "insufficient") w.toast("Not enough coins — top up to unlock");
    else w.toast("Couldn't confirm the unlock — you weren't charged");
    setRetryKey((k) => k + 1);   // re-ask the server either way
  };

  const unlockAll = async () => {
    if (!locked || busy) return;
    setBusy("bundle");
    const r = await w.unlockBundle(series.slug);
    setBusy(null);
    if (r.ok) w.toast(`Unlocked all ${locked.remaining} episodes · −${fmt(r.spent)} coins`);
    else if (r.reason === "insufficient") w.toast("Not enough coins for the full bundle");
    else w.toast("Couldn't confirm the bundle — you weren't charged");
    setRetryKey((k) => k + 1);
  };

  return (
    <div className="playerpage">
      <div className="pstage">
        <div
          className="vfill"
          style={{ "--v1": series.c1, "--v2": series.c2, opacity: videoOk ? 0 : 1 } as CSSProperties}
        />
        {playing && (
          <video
            ref={videoRef}
            playsInline
            controls={false}
            muted={muted}
            autoPlay
            crossOrigin="anonymous"
            onEnded={() => setEnded(true)}
            style={{ opacity: videoOk ? 1 : 0 }}
          >
            {access.captions.map((c) => (
              <track key={c.lang} kind="subtitles" src={c.url} srcLang={c.lang} label={c.label} />
            ))}
          </video>
        )}
        <div className="vig" />

        {playing && cueText && (
          <div className="subt">
            {cueText.split("\n").map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}

        <div className="ptop">
          <Link className="pback" href={`/series/${series.slug}`} aria-label="Back">
            <Icon.Back />
          </Link>
          <div className="name">
            <b>{series.title}</b>
            <span>
              E{n}
              {epTitle ? ` · ${epTitle}` : ""}
            </span>
          </div>
        </div>

        {playing && (
          <div className="prail">
            <button aria-label={liked ? "Unlike" : "Like"} aria-pressed={liked} onClick={() => setLiked((l) => !l)}>
              <Icon.Heart filled={liked} />
            </button>
            {captionOptions.length > 1 && (
              <button aria-label={`Captions: ${currentCaption.label}`} onClick={cycleCaptions}>
                <Icon.Captions />
                <small>{currentCaption.label}</small>
              </button>
            )}
            <button aria-label={muted ? "Unmute" : "Mute"} onClick={toggleMute}>
              {muted ? <Icon.SpeakerOff /> : <Icon.SpeakerOn />}
            </button>
            <button aria-label={remind ? "Stop reminders" : "Remind me"} aria-pressed={remind} onClick={toggleRemind}>
              <Icon.Bell ringing={remind} />
            </button>
          </div>
        )}

        {playing && (
          <div className="pbottom">
            <div className="ptitle">
              {access.free ? `Free episode ${n}` : "Unlocked episode"} · {series.language}
            </div>
            <div
              className="seek"
              style={{ "--played": `${pct}%` } as CSSProperties}
              role="slider"
              tabIndex={0}
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.floor(dur)}
              aria-valuenow={Math.floor(cur)}
              aria-valuetext={`${clock(cur)} of ${clock(dur)}`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture?.(e.pointerId);
                seekFromPointer(e.clientX, e.currentTarget);
              }}
              onPointerMove={(e) => {
                if (e.buttons === 1) seekFromPointer(e.clientX, e.currentTarget);
              }}
              onKeyDown={(e) => {
                const step = e.key === "PageUp" || e.key === "PageDown" ? 30 : 5;
                if (e.key === "ArrowRight" || e.key === "PageUp") seekTo(cur + step);
                else if (e.key === "ArrowLeft" || e.key === "PageDown") seekTo(cur - step);
                else if (e.key === "Home") seekTo(0);
                else if (e.key === "End") seekTo(dur);
                else return;
                e.preventDefault();
              }}
            >
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="pctrl">
              <button onClick={() => n > 1 && goto(n - 1)} aria-label="Previous">
                <Icon.Prev />
              </button>
              <button onClick={togglePlay} aria-label={paused ? "Play" : "Pause"}>
                {paused ? <Icon.Play /> : <Icon.Pause />}
              </button>
              <button onClick={() => n < series.episodeCount && goto(n + 1)} aria-label="Next episode">
                <Icon.Next />
              </button>
              <span className="ptime">
                {clock(cur)} / {clock(dur)}
              </span>
            </div>
          </div>
        )}

        {gate === "locked" && (
          <PinGate
            rating={rating ?? series.rating}
            backHref={`/series/${series.slug}`}
            onUnlocked={() => setGate("open")}
          />
        )}
        {locked && <Paywall {...locked} />}
        {(access.kind === "error" || (playing && streamError)) && <StreamError />}
        {playing && ended && !streamError && <EndCard />}
      </div>
    </div>
  );

  function EndCard() {
    return (
      <div className="overlay">
        <div className="ocard">
          <h3>Episode {n} finished</h3>
          {hasNext ? (
            <p>Next: E{n + 1}{nextEp ? ` · ${nextEp.title}` : ""}</p>
          ) : (
            <p>That was the last episode of {series.title}.</p>
          )}
          {hasNext && (
            <button className="btn p" onClick={() => goto(n + 1)}>
              Play E{n + 1}
            </button>
          )}
          <button className="btn s" onClick={replay}>
            Replay
          </button>
          <Link className="olink" href={`/series/${series.slug}`}>
            Back to the series
          </Link>
        </div>
      </div>
    );
  }

  function StreamError() {
    return (
      <div className="overlay">
        <div className="ocard">
          <h3>Stream unavailable</h3>
          <p>We couldn&apos;t load this episode. Check your connection and try again.</p>
          <button
            className="btn p"
            onClick={() => {
              setStreamError(false);
              setRetryKey((k) => k + 1);
            }}
          >
            Try again
          </button>
          <Link className="olink" href={`/series/${series.slug}`}>
            Back to the series
          </Link>
        </div>
      </div>
    );
  }

  function Paywall({ price, balance, remaining, bundle }: Extract<Access, { kind: "locked" }>) {
    const need = price - balance;
    return (
      <div className="overlay">
        <div className="ocard">
          <h3>Unlock Episode {n}</h3>
          <p>
            {epTitle ? `${epTitle} · then keep bingeing ${series.title}` : `Keep bingeing ${series.title}`}
          </p>

          {!w.signed ? (
            <>
              <p style={{ marginTop: -6 }}>
                The free episodes are behind you. Sign in with your phone to unlock the rest with coins —
                this one is {fmt(price)} coins.
              </p>
              <button className="btn p" onClick={() => w.openSignIn(here)}>
                Sign in to continue
              </button>
            </>
          ) : (
            <>
              <span className="balance">
                <span className="coin" />
                {fmt(balance)} <small>coins in your wallet</small>
              </span>
              {need > 0 ? (
                <>
                  <Link className="btn gold" href="/coins">
                    Get coins · you need {fmt(need)} more
                  </Link>
                  <button className="btn s" disabled>
                    Unlock for {fmt(price)} coins
                  </button>
                </>
              ) : (
                <>
                  <button className="btn p" disabled={busy !== null} onClick={unlockOne}>
                    <span className="coin s" /> {busy === "episode" ? "Unlocking…" : `Unlock for ${fmt(price)} coins`}
                  </button>
                  {remaining > 1 && (
                    <button
                      className="btn s"
                      disabled={busy !== null}
                      onClick={() => {
                        if (balance < bundle) {
                          w.toast("Not enough coins for the full bundle");
                          return;
                        }
                        unlockAll();
                      }}
                    >
                      {busy === "bundle" ? "Unlocking…" : `Unlock all ${remaining} left · ${fmt(bundle)} coins`}
                    </button>
                  )}
                </>
              )}
            </>
          )}
          <Link className="olink" href={`/series/${series.slug}`}>
            Not now — back to the series
          </Link>
        </div>
      </div>
    );
  }
}

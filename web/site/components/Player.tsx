"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "./WalletProvider";
import { api } from "@/lib/api";
import { Series, fmt } from "@/lib/catalog";

/**
 * The server decides. Every render of this page starts with the playback
 * endpoint: it answers either with a signed stream (entitled — free or
 * unlocked) or with the paywall and every number the paywall shows (price,
 * balance, how many episodes are left, the exact bundle offer). Nothing here
 * computes a price or remembers an unlock.
 */
type Access =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "play"; url: string; free: boolean }
  | { kind: "locked"; price: number; balance: number; remaining: number; bundle: number };

export default function Player({ series, n }: { series: Series; n: number }) {
  const w = useWallet();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [access, setAccess] = useState<Access>({ kind: "loading" });
  const [videoOk, setVideoOk] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [busy, setBusy] = useState<"episode" | "bundle" | null>(null);

  const ep = series.episodes.find((e) => e.number === n) || series.episodes[0];

  // 1. Ask the server whether this viewer may watch this episode. Re-asked
  //    whenever identity or the wallet changes (sign-in, purchase, unlock).
  useEffect(() => {
    if (!w.ready) return;
    let cancelled = false;
    setAccess({ kind: "loading" });
    setVideoOk(false);
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
          setAccess({ kind: "play", url: pb.hls_master_url, free: pb.free });
        } else {
          setAccess({ kind: "error" });
        }
      })
      .catch(() => !cancelled && setAccess({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, [series.slug, n, w.ready, w.signed, w.balance, retryKey]);

  // 2. Attach hls.js only once the server has handed us a stream.
  const src = access.kind === "play" ? access.url : null;
  useEffect(() => {
    if (!src) return;
    const video = videoRef.current;
    if (!video) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;

    setStreamError(false);
    (async () => {
      try {
        const reveal = () => !cancelled && setVideoOk(true);
        // Prefer hls.js wherever MSE exists: Chrome answers "maybe" to the
        // native canPlayType probe but cannot actually demux HLS.
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (cancelled) return;
        if (Hls.isSupported()) {
          const inst = new Hls({ maxBufferLength: 10 });
          hls = inst;
          inst.loadSource(src);
          inst.attachMedia(video);
          // Reveal on real frames (not MANIFEST_PARSED): if the media stack
          // can't open MSE the gradient poster simply stays.
          video.addEventListener("loadeddata", reveal, { once: true });
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
    };
  }, [src, series.slug, n]);

  const goto = (num: number) => router.push(`/watch/${series.slug}/${num}`);
  const playing = access.kind === "play";
  const locked = access.kind === "locked" ? access : null;

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
            muted
            autoPlay
            loop
            style={{ opacity: videoOk ? 1 : 0 }}
          />
        )}
        <div className="vig" />

        <div className="ptop">
          <Link href={`/series/${series.slug}`} aria-label="Back" style={{ fontSize: 22, color: "#fff" }}>
            ‹
          </Link>
          <div className="name">
            <b>{series.title}</b>
            <span>
              E{n} · {ep.title}
            </span>
          </div>
        </div>

        {playing && (
          <div className="pbottom">
            <div className="ptitle">
              {access.free ? `Free episode ${n}` : "Unlocked episode"} · {series.language}
            </div>
            <div className="seek">
              <i style={{ width: "38%" }} />
            </div>
            <div className="pctrl">
              <button onClick={() => n > 1 && goto(n - 1)} aria-label="Previous">
                ‹‹
              </button>
              <button onClick={() => n < series.episodeCount && goto(n + 1)} aria-label="Next episode">
                ▶▶
              </button>
              <span>0:23 / 1:04</span>
            </div>
          </div>
        )}

        {locked && <Paywall {...locked} />}
        {(access.kind === "error" || (playing && streamError)) && <StreamError />}
      </div>
    </div>
  );

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
            {ep.title} · then keep bingeing {series.title}
          </p>

          {!w.signed ? (
            <>
              <p style={{ marginTop: -6 }}>
                The free episodes are behind you. Sign in with your phone to unlock the rest with coins —
                this one is {fmt(price)} coins.
              </p>
              <button className="btn p" onClick={() => w.openSignIn(`/watch/${series.slug}/${n}`)}>
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
                    Unlock for {fmt(price)}
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
                      {busy === "bundle" ? "Unlocking…" : `Unlock all ${remaining} left · ${fmt(bundle)}`}
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

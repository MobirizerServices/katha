"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "./WalletProvider";
import { api } from "@/lib/api";
import {
  Series,
  isFreeEpisode,
  FREE_EPISODES,
  EPISODE_COIN_PRICE,
  BUNDLE_DISCOUNT_PCT,
  bundleCost,
  coinsToRupees,
  fmt,
} from "@/lib/catalog";

export default function Player({ series, n }: { series: Series; n: number }) {
  const w = useWallet();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoOk, setVideoOk] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const ep = series.episodes.find((e) => e.number === n) || series.episodes[0];
  const free = isFreeEpisode(n);
  // Access is resolved on the client once the wallet has hydrated.
  const accessible = free || (w.ready && w.hasUnlocked(series.slug, n));
  const locked = w.ready && !accessible;

  const bundle = bundleCost(series);
  const remaining = series.episodes.filter((e) => !isFreeEpisode(e.number) && !w.hasUnlocked(series.slug, e.number)).length;
  const need = EPISODE_COIN_PRICE - w.balance;

  // Attach hls.js only when the episode is watchable.
  useEffect(() => {
    if (!accessible) return;
    const video = videoRef.current;
    if (!video) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;

    setStreamError(false);
    (async () => {
      try {
        // Authoritative source: the playback endpoint returns the signed HLS
        // master for entitled viewers (locally: the generated /media stream).
        // A failure here is an ERROR, never a silent substitute — playing a
        // stand-in stream as if it were the entitled episode misleads.
        let src: string | null = null;
        try {
          const pb = await api.playback(series.slug, n);
          if (pb && pb.hls_master_url) src = pb.hls_master_url as string;
        } catch {
          /* handled below as the error state */
        }
        if (cancelled) return;
        if (!src) {
          setStreamError(true);
          return;
        }
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
                if (fresh && fresh.hls_master_url) inst.loadSource(fresh.hls_master_url as string);
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
  }, [accessible, series.slug, n, retryKey]);

  const goto = (num: number) => router.push(`/watch/${series.slug}/${num}`);

  return (
    <div className="playerpage">
      <div className="pstage">
        <div
          className="vfill"
          style={{ "--v1": series.c1, "--v2": series.c2, opacity: videoOk ? 0 : 1 } as CSSProperties}
        />
        {accessible && (
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

        {accessible && (
          <>
            <div className="subt">{free ? "" : ""}</div>
            <div className="pbottom">
              <div className="ptitle">
                {free ? `Free episode ${n} of ${FREE_EPISODES}` : "Unlocked episode"} · {series.language}
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
          </>
        )}

        {locked && <Paywall />}
        {accessible && streamError && <StreamError />}
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

  function Paywall() {
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
                Your first {FREE_EPISODES} episodes were free. Sign in with your phone to unlock the rest with
                coins — about ₹{coinsToRupees(EPISODE_COIN_PRICE)} an episode.
              </p>
              <button className="btn p" onClick={() => w.openSignIn(`/watch/${series.slug}/${n}`)}>
                Sign in to continue
              </button>
            </>
          ) : (
            <>
              <span className="balance">
                <span className="coin" />
                {fmt(w.balance)} <small>coins in your wallet</small>
              </span>
              {need > 0 ? (
                <>
                  <Link className="btn gold" href="/coins">
                    Get coins · you need {fmt(need)} more
                  </Link>
                  <button className="btn s" disabled>
                    Unlock for {EPISODE_COIN_PRICE}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn p"
                    onClick={() => {
                      if (w.unlockEpisode(series.slug, n, EPISODE_COIN_PRICE))
                        w.toast(`Episode ${n} unlocked · −${EPISODE_COIN_PRICE} coins`);
                    }}
                  >
                    <span className="coin s" /> Unlock for {EPISODE_COIN_PRICE} coins
                  </button>
                  {remaining > 1 && (
                    <button
                      className="btn s"
                      onClick={() => {
                        if (w.balance < bundle) {
                          w.toast("Not enough coins for the full bundle");
                          return;
                        }
                        if (w.unlockBundle(series.slug, bundle))
                          w.toast(`Unlocked all ${remaining} episodes · −${fmt(bundle)} coins`);
                      }}
                    >
                      Unlock all {remaining} left · {fmt(bundle)}{" "}
                      <span style={{ color: "var(--coin)" }}>−{BUNDLE_DISCOUNT_PCT}%</span>
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

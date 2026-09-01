import Link from "next/link";
import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import SiteFooter from "@/components/SiteFooter";
import {
  getSeries,
  allSlugs,
  coverUrl,
  FREE_EPISODES,
  EPISODE_COIN_PRICE,
  BUNDLE_DISCOUNT_PCT,
  bundleCost,
  fullLockedCost,
  coinsToRupees,
  fmt,
} from "@/lib/catalog";

export function generateStaticParams() {
  return allSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const s = getSeries(slug);
  if (!s) return { title: "Series not found" };
  return {
    title: s.title,
    description: s.synopsis,
    openGraph: { title: s.title, description: s.synopsis, type: "video.tv_show" },
  };
}

export default async function SeriesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = getSeries(slug);
  if (!s) notFound();

  const bundle = bundleCost(s);
  const full = fullLockedCost(s);

  return (
    <>
      <section className="billboard">
        <div
          className="art"
          style={{
            "--c1": s.c1,
            "--c2": s.c2,
            backgroundImage: `linear-gradient(to top, rgba(8,8,12,.82), rgba(8,8,12,.25) 55%), url(${coverUrl(s.slug, true)})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          } as CSSProperties}
        />
        <div className="bb">
          <div className="kicker">#{s.rank} in India today</div>
          <h1>{s.title}</h1>
          <div className="meta">
            <span className="rating">{s.rating}</span>
            <span>{s.genres.join(" · ")}</span>
            <span className="dotsep" />
            <span>{s.episodeCount} episodes</span>
            <span className="dotsep" />
            <span>{s.language}</span>
          </div>
          <p className="hook">{s.synopsis}</p>
          <div className="ctas" style={{ marginTop: 0 }}>
            <Link className="btn p pill" href={`/watch/${s.slug}/1`}>
              ▶ Play E1 free
            </Link>
            <Link className="btn s pill" href="/coins">
              Get coins
            </Link>
          </div>
        </div>
      </section>

      <section className="wrap" style={{ padding: "32px 24px 8px" }}>
        <div
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            alignItems: "center",
            color: "var(--text2)",
            fontSize: 14,
          }}
        >
          <span>
            <span className="coin" style={{ verticalAlign: "-3px", marginRight: 6 }} />
            First {FREE_EPISODES} free · then {EPISODE_COIN_PRICE} coins (≈ ₹{coinsToRupees(EPISODE_COIN_PRICE)}) per episode
          </span>
          {s.episodeCount > FREE_EPISODES && (
            <span>
              · Series bundle: unlock all {s.episodeCount - FREE_EPISODES} remaining for{" "}
              <b style={{ color: "var(--text)" }}>{fmt(bundle)} coins</b>{" "}
              <span style={{ color: "var(--coin)" }}>
                (−{BUNDLE_DISCOUNT_PCT}%, was {fmt(full)})
              </span>
            </span>
          )}
        </div>
      </section>

      <section className="wrap" style={{ padding: "20px 24px 60px" }}>
        <h2 style={{ fontSize: 20, margin: "0 0 14px" }}>Episodes</h2>
        <div className="epgrid">
          {s.episodes.map((e) => {
            const free = e.isFree;
            return (
              <Link key={e.number} className="epcell" href={`/watch/${s.slug}/${e.number}`}>
                <div className="n">Episode {e.number}</div>
                <div className="et">{e.title !== `Episode ${e.number}` ? e.title : ""}</div>
                {free ? (
                  <span className="flag free">● Free</span>
                ) : (
                  <span className="flag lock">🔒 {EPISODE_COIN_PRICE} coins</span>
                )}
              </Link>
            );
          })}
        </div>
      </section>

      <SiteFooter />
    </>
  );
}

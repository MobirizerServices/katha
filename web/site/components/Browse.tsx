"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import SeriesCard from "./SeriesCard";
import { LANGUAGES, allGenres, filterSeries, languageName, metaLine, coverUrl, FREE_EPISODES, type Series } from "@/lib/catalog";

/**
 * Browse the catalog by genre and language. Both filters live in the query
 * string (?genre=Romance&lang=ta) so a filtered view is a shareable URL and
 * the back button undoes a chip. The grid is the static seed catalog — no
 * money or access fact is shown here, only what exists.
 */
export default function Browse({ series }: { series: Series[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const genre = params.get("genre");
  const lang = params.get("lang");
  const genres = allGenres(series);
  const shown = filterSeries(series, { genre, lang: lang ? languageName(lang) : null });

  const set = (key: "genre" | "lang", value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `/browse?${qs}` : "/browse");
  };

  return (
    <>
      <div className="wrap" style={{ paddingTop: 30 }}>
        <h1 style={{ fontSize: 24, margin: "0 0 6px" }}>Browse</h1>
        {shown.length > 0 && (
          <p style={{ color: "var(--text2)", margin: 0 }}>
            {shown.length} series · first {FREE_EPISODES} episodes of each are free
          </p>
        )}
      </div>

      <div className="chips" role="group" aria-label="Language">
        <button className={`chip ${!lang ? "on" : ""}`} aria-pressed={!lang} onClick={() => set("lang", null)}>
          All languages
        </button>
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            className={`chip ${lang === l.code ? "on" : ""}`}
            aria-pressed={lang === l.code}
            onClick={() => set("lang", l.code)}
          >
            {l.native} · {l.name}
          </button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Genre" style={{ paddingTop: 10 }}>
        <button className={`chip ${!genre ? "on" : ""}`} aria-pressed={!genre} onClick={() => set("genre", null)}>
          All genres
        </button>
        {genres.map((g) => (
          <button
            key={g}
            className={`chip ${genre === g ? "on" : ""}`}
            aria-pressed={genre === g}
            onClick={() => set("genre", g)}
          >
            {g}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <h3>Nothing here yet</h3>
          <p>No series matches those filters. Try another genre or language.</p>
          <Link className="btn s sm" href="/browse" style={{ display: "inline-flex" }}>
            Clear filters
          </Link>
        </div>
      ) : (
        <div className="grid">
          {shown.map((s) => (
            <SeriesCard
              key={s.slug}
              slug={s.slug}
              title={s.title}
              meta={metaLine(s.language, s.genres[0], s.episodeCount)}
              cover={coverUrl(s.slug)}
              c1={s.c1}
              c2={s.c2}
              badge={`Free · ${FREE_EPISODES} eps`}
            />
          ))}
        </div>
      )}
    </>
  );
}

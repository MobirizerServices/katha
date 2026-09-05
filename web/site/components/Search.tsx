"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import SeriesCard from "./SeriesCard";
import { api, type SearchDTO, type SearchPersonDTO, type SeriesSummaryDTO } from "@/lib/api";
import { countLabel, languageName, metaLine } from "@/lib/catalog";

const DEBOUNCE_MS = 250;
const SUGGESTIONS = ["saas-bahu", "revenge", "ceo", "palace", "college", "contract marriage", "thriller"];

type State = "idle" | "loading" | "done" | "error";

/**
 * Catalog search against /v1/search: typing is debounced, the term is
 * mirrored into ?q= so a result page can be shared, and the server's two
 * result lists (series, people) render as two sections.
 */
export default function Search() {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [result, setResult] = useState<SearchDTO | null>(null);
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResult(null);
      setState("idle");
      return;
    }
    setState("loading");
    let cancelled = false;
    const t = setTimeout(() => {
      router.replace(`/search?q=${encodeURIComponent(term)}`);
      api
        .search(term)
        .then((r) => {
          if (cancelled) return;
          setResult(r);
          setState("done");
        })
        .catch(() => !cancelled && setState("error"));
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, router]);

  const term = q.trim();
  const nothing = state === "done" && result && result.series.length === 0 && result.people.length === 0;

  return (
    <>
      <div className="wrap" style={{ paddingTop: 30 }}>
        <h1 style={{ fontSize: 24, margin: "0 0 6px" }}>{term ? `Results for “${term}”` : "Search"}</h1>
        <p style={{ color: "var(--text2)", margin: "0 0 14px" }}>
          {state === "done" && result
            ? `${countLabel(result.series.length, "series", "series")} · ${countLabel(
                result.people.length,
                "person",
                "people"
              )}`
            : "Try a title, a genre, a mood, or an actor."}
        </p>
        <input
          className="searchinput"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search series and people"
          aria-label="Search"
          autoFocus
        />
      </div>

      {state === "idle" && (
        /* An empty query used to leave the chips hanging 14px above the footer
           border, so the page read as truncated. */
        <section className="wrap" aria-label="Trending searches" style={{ paddingTop: 26, paddingBottom: 56 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 10px", color: "var(--text2)", fontWeight: 600 }}>
            Trending searches
          </h2>
          <div className="chips" style={{ padding: 0 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => setQ(s)}>
                {s}
              </button>
            ))}
          </div>
        </section>
      )}
      {state === "loading" && <p className="wrap muted" aria-busy="true">Searching…</p>}
      {state === "error" && (
        <p className="wrap muted" role="alert">
          Search is unavailable right now. Try again in a moment.
        </p>
      )}
      {nothing && (
        <div className="empty">
          <h3>Nothing for “{term}”</h3>
          <p>Check the spelling, or browse by language.</p>
          <Link className="btn s sm" href="/browse" style={{ display: "inline-flex" }}>
            Browse all
          </Link>
        </div>
      )}

      {state === "done" && result && result.series.length > 0 && (
        <section aria-label="Series">
          <div className="wrap rowhead">
            <h2>Series</h2>
          </div>
          <SummaryGrid series={result.series} />
        </section>
      )}
      {state === "done" && result && result.people.length > 0 && (
        <section aria-label="People">
          <div className="wrap rowhead">
            <h2>People</h2>
          </div>
          <div className="wrap" style={{ display: "grid", gap: 8 }}>
            {result.people.map((p) => (
              <PersonRow key={p.name} person={p} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function SummaryGrid({ series }: { series: SeriesSummaryDTO[] }) {
  return (
    <div className="grid">
      {series.map((s) => (
        <SeriesCard
          key={s.slug}
          slug={s.slug}
          title={s.title}
          meta={metaLine(languageName(s.primary_language), s.genres[0], s.episode_count)}
          cover={s.cover_url}
          badge={s.content_rating}
        />
      ))}
    </div>
  );
}

/** name · role · N series; expands to the series they are billed in. */
function PersonRow({ person }: { person: SearchPersonDTO }) {
  const [open, setOpen] = useState(false);
  const n = person.series.length;
  return (
    <div className="person">
      <button className="personrow" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="avatar" aria-hidden="true">{person.name.charAt(0)}</span>
        <span>
          <b>{person.name}</b> · {person.role} · {n} series
        </span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && <SummaryGrid series={person.series} />}
    </div>
  );
}

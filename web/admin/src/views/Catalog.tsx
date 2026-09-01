import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Series } from "../api/types";
import { Empty, PageHeader, Skeleton, StatusBadge, fmtN } from "../ui";
import type { SeriesStatus } from "../api/types";

const LANGS = ["All", "Hindi", "Tamil", "Telugu"];
const STATUSES = ["All statuses", "live", "scheduled", "draft", "archived"];

function toBadge(status: string): SeriesStatus {
  const map: Record<string, SeriesStatus> = {
    live: "live", scheduled: "sched", draft: "draft", archived: "arch", qc: "qc",
  };
  return map[status] ?? "live";
}

export function Catalog() {
  const [rows, setRows] = useState<Series[] | null>(null);
  const [q, setQ] = useState("");
  const [lang, setLang] = useState("All");
  const [status, setStatus] = useState("All statuses");

  useEffect(() => {
    void api.listSeries().then(setRows);
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter((s) => {
      if (lang !== "All" && s.language !== lang) return false;
      const norm = (st: string) =>
        (({ sched: "scheduled", arch: "archived", qc: "draft" }) as Record<string, string>)[st] ?? st;
      if (status !== "All statuses" && norm(s.status) !== status) return false;
      const needle = q.trim().toLowerCase();
      if (needle &&
          !s.title.toLowerCase().includes(needle) &&
          !s.slug.includes(needle) &&
          !s.genres.some((g) => g.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [rows, q, lang, status]);

  const total = rows?.reduce((n, s) => n + s.episodeCount, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Catalog"
        subtitle={rows
          ? `${rows.length} series · ${fmtN(total)} episodes · 3 languages. First ${rows[0]?.freeEpisodes ?? 10} episodes of every series are free, then ${rows[0]?.coinPrice ?? 30} coins each.`
          : "Loading catalog…"}
      />

      <div className="filters">
        <input placeholder="Search title, slug or genre…" value={q}
               onChange={(e) => setQ(e.target.value)} aria-label="Search catalog" />
        <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
          {LANGS.map((l) => <option key={l}>{l}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {rows === null ? (
        <Skeleton rows={6} />
      ) : filtered.length === 0 ? (
        <Empty title="No series match" hint="Clear a filter, or draft a new series (coming with the content pipeline)." />
      ) : (
        <table className="table cat">
          <thead>
            <tr>
              <th>Series</th><th>Language</th><th>Rating</th>
              <th style={{ textAlign: "right" }}>Episodes</th>
              <th>Free</th><th>Price</th><th>Bundle</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.slug}>
                <td>
                  <Link to={`/catalog/${s.slug}`} className="serieslink">
                    <img className="covermini" alt=""
                         src={`http://127.0.0.1:8799/media/${s.slug}/cover_9x16.jpg`}
                         onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                    <span>
                      <b>{s.title}</b>
                      <small className="muted"> {s.genres.join(" · ")} · {s.slug}</small>
                    </span>
                  </Link>
                </td>
                <td>{s.language}</td>
                <td><span className="rt">{s.rating}</span></td>
                <td style={{ textAlign: "right" }} className="mono">{s.episodeCount}</td>
                <td>{s.freeEpisodes} free</td>
                <td>{s.coinPrice} coins</td>
                <td>−{s.bundleDiscountPct}%</td>
                <td><StatusBadge status={toBadge(s.status)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { Series } from "../api/types";
import { PageHeader, Poster, StatusBadge, ago } from "../ui";

const LANGS = ["All", "Hindi", "Tamil", "Telugu"];
const STATUSES = ["All", "live", "sched", "qc", "draft", "arch"];

export function Catalog() {
  const [series, setSeries] = useState<Series[]>([]);
  const [q, setQ] = useState("");
  const [lang, setLang] = useState("All");
  const [status, setStatus] = useState("All");

  useEffect(() => {
    api.listSeries().then(setSeries);
  }, []);

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return series.filter(
      (s) =>
        (lang === "All" || s.language === lang) &&
        (status === "All" || s.status === status) &&
        (!query ||
          s.title.toLowerCase().includes(query) ||
          s.slug.includes(query) ||
          s.genres.join(" ").toLowerCase().includes(query))
    );
  }, [series, q, lang, status]);

  const totalEps = series.reduce((a, s) => a + s.episodeCount, 0);

  return (
    <>
      <PageHeader
        title="Catalog"
        subtitle={`${series.length} series · ${totalEps.toLocaleString("en-IN")} episodes · 3 languages. First 10 episodes of every series are free, then 30 coins each.`}
      />

      <div className="filters">
        <div className="search">
          <span>⌕</span>
          <input
            placeholder="Search title, slug or genre…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select value={lang} onChange={(e) => setLang(e.target.value)}>
          {LANGS.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "All" ? "All statuses" : s}
            </option>
          ))}
        </select>
      </div>

      <div className="panel">
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr>
                <th>Series</th>
                <th>Language</th>
                <th>Rating</th>
                <th className="num">Episodes</th>
                <th>Free</th>
                <th className="num">Price</th>
                <th className="num">Bundle</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={s.id}>
                  <td>
                    <div className="cell">
                      <Poster i={i} />
                      <div>
                        <div className="tt">{s.title}</div>
                        <div className="ss">
                          {s.genres.join(" · ")} · {s.slug}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{s.language}</td>
                  <td>
                    {s.rating === "—" ? (
                      <span className="tag">unrated</span>
                    ) : (
                      <span className="tag">{s.rating}</span>
                    )}
                  </td>
                  <td className="num">
                    {s.liveCount} / {s.episodeCount}
                  </td>
                  <td>{s.freeEpisodes} free</td>
                  <td className="num">{s.coinPrice} coins</td>
                  <td className="num">−{s.bundleDiscountPct}%</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td>
                    <span className="muted">{ago(s.updatedAt)}</span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <div className="empty">
                      <h4>No series match</h4>
                      <p>Try clearing a filter.</p>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

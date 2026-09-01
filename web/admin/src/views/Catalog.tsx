import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, mutate } from "../api/client";
import type { Series } from "../api/types";
import { Empty, Modal, PageHeader, Skeleton, StatusBadge, fmtN } from "../ui";
import type { SeriesStatus } from "../api/types";
import { useStore } from "../store";
import { canAct } from "../auth/roles";

const LANGS = ["All", "Hindi", "Tamil", "Telugu"];
const STATUSES = ["All statuses", "live", "scheduled", "draft", "archived"];

function toBadge(status: string): SeriesStatus {
  const map: Record<string, SeriesStatus> = {
    live: "live", scheduled: "sched", draft: "draft", archived: "arch", qc: "qc",
  };
  return map[status] ?? "live";
}

function NewSeriesDialog({ onClose, onCreated }:
                         { onClose: () => void; onCreated: () => void }) {
  const { online, showToast } = useStore();
  const [f, setF] = useState({ slug: "", title: "", language: "hi",
                               episode_count: 60, coin_price: 30,
                               free_episodes: 10, synopsis: "" });

  async function create() {
    const res = await mutate.createSeries(f);
    if ("offline" in res) return showToast("Offline — nothing created", "error");
    if (res.error) return showToast(`Not created: ${res.error}`, "error");
    showToast(`${f.title} drafted — add media, then publish from its page`);
    onCreated();
    onClose();
  }

  return (
    <Modal title="New series (draft)" onClose={onClose}
           footer={
             <>
               <button className="btn s" onClick={onClose}>Cancel</button>
               <button className="btn p" disabled={!online || !f.slug || !f.title}
                       onClick={() => void create()}>
                 Create draft
               </button>
             </>
           }>
      <p className="tiny">
        The pipeline starts in the tool (#043): metadata now, media later. The
        draft stays out of the apps until you publish it live.
      </p>
      <div className="frow">
        <label>
          Slug (a-z, 0-9, hyphens)
          <input value={f.slug} aria-label="Slug"
                 onChange={(e) => setF({ ...f, slug: e.target.value })}
                 placeholder="meri-adhuri-kahani" />
        </label>
        <label>
          Title
          <input value={f.title} aria-label="Title"
                 onChange={(e) => setF({ ...f, title: e.target.value })}
                 placeholder="Meri Adhuri Kahani" />
        </label>
      </div>
      <div className="frow">
        <label>
          Language
          <select value={f.language} aria-label="Language of series"
                  onChange={(e) => setF({ ...f, language: e.target.value })}>
            <option value="hi">Hindi</option>
            <option value="ta">Tamil</option>
            <option value="te">Telugu</option>
          </select>
        </label>
        <label>
          Episodes
          <input type="number" value={f.episode_count} aria-label="Episode count"
                 onChange={(e) => setF({ ...f, episode_count: Number(e.target.value) })} />
        </label>
        <label>
          Coins/episode
          <input type="number" value={f.coin_price} aria-label="Coin price"
                 onChange={(e) => setF({ ...f, coin_price: Number(e.target.value) })} />
        </label>
        <label>
          Free episodes
          <input type="number" value={f.free_episodes} aria-label="Free episode count"
                 onChange={(e) => setF({ ...f, free_episodes: Number(e.target.value) })} />
        </label>
      </div>
      <label>
        Synopsis
        <input value={f.synopsis} aria-label="Synopsis"
               onChange={(e) => setF({ ...f, synopsis: e.target.value })} />
      </label>
    </Modal>
  );
}

export function Catalog() {
  const { role, online } = useStore();
  const [creating, setCreating] = useState(false);
  const [rows, setRows] = useState<Series[] | null>(null);
  const [q, setQ] = useState("");
  const [lang, setLang] = useState("All");
  const [status, setStatus] = useState("All statuses");

  const load = () => void api.listSeries().then(setRows);
  useEffect(load, []);

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
        actions={canAct(role, "content") ? (
          <button className="btn p" disabled={!online}
                  onClick={() => setCreating(true)}>
            New series…
          </button>
        ) : null}
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
      {creating ? (
        <NewSeriesDialog onClose={() => setCreating(false)} onCreated={load} />
      ) : null}
    </>
  );
}

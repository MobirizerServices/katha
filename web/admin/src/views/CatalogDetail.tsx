import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, mutate } from "../api/client";
import type { SeriesDetail } from "../api/client";
import { Empty, IsoTime, Modal, PageHeader, Sev, Skeleton, StatusBadge } from "../ui";
import { useStore } from "../store";
import { canAct } from "../auth/roles";
import type { SeriesStatus } from "../api/types";

const RATINGS = ["U", "U/A 7+", "U/A 13+", "U/A 16+", "A"];

function toBadge(status: string): SeriesStatus {
  const map: Record<string, SeriesStatus> = {
    live: "live", scheduled: "sched", draft: "draft", archived: "arch",
  };
  return map[status] ?? "live";
}

export function CatalogDetail() {
  const { slug = "" } = useParams();
  const { role, online, showToast } = useStore();
  const [d, setD] = useState<SeriesDetail | null | undefined>(undefined);
  const [takedown, setTakedown] = useState(false);
  const [reason, setReason] = useState("");
  const [rateOpen, setRateOpen] = useState(false);
  const [rating, setRating] = useState("U/A 13+");
  const [rateReason, setRateReason] = useState("");

  const load = useCallback(() => {
    void api.seriesDetail(slug).then(setD);
  }, [slug]);
  useEffect(load, [load]);

  async function setStatus(status: string, why = "") {
    const res = await mutate.setStatus(slug, status, why);
    if ("offline" in res) return showToast("Offline — status unchanged", "error");
    if (res.error) return showToast(`Status not changed: ${res.error}`, "error");
    showToast(`Status → ${status}${why ? " · reason recorded" : ""} · audited`);
    setTakedown(false);
    setReason("");
    load();
  }

  async function applyRating() {
    const res = await mutate.setRating(slug, rating, rateReason.trim());
    if ("offline" in res) return showToast("Offline — rating unchanged", "error");
    if (res.error) return showToast(`Rating not changed: ${res.error}`, "error");
    showToast(`Rated ${rating} · accountable to you in the audit log`);
    setRateOpen(false);
    setRateReason("");
    load();
  }

  if (d === undefined) return <Skeleton rows={6} />;
  if (d === null) {
    return <Empty title="Series not found"
                  hint="It may have been removed — check the catalog list." />;
  }

  const mediaOk = d.media.episodes_missing === 0 && d.media.covers_ok;
  const contentRole = canAct(role, "content");
  const qcRole = canAct(role, "qc,content");

  return (
    <>
      <PageHeader
        crumbs={<Link to="/catalog">Catalog</Link>}
        title={d.title}
        subtitle={`${d.language} · ${d.genres.join(" · ")} · ${d.episodeCount} episodes · first ${d.freeEpisodes} free, then ${d.coinPrice} coins (bundle −${d.bundleDiscountPct}%)`}
        actions={
          <>
            <a className="btn s" href={d.previewWeb} target="_blank" rel="noreferrer">
              Preview on web ↗
            </a>
            <button className="btn s"
                    onClick={() => {
                      void navigator.clipboard?.writeText(`katha://series/${d.slug}`);
                      showToast("App deep link copied");
                    }}>
              Copy app link
            </button>
          </>
        }
      />

      <div className="split">
        <div className="panel">
          <header><h3>Publishing</h3><StatusBadge status={toBadge(d.status)} /></header>
          <div className="acct">
            <p className="tiny">
              Only <b>live</b> series appear in the apps; a change lands on core-api's
              next request. Takedowns record a reason (grievance id welcome).
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["live", "scheduled", "draft"].map((st) => (
                <button key={st} className="btn s"
                        disabled={!contentRole || !online || d.status === st}
                        onClick={() => void setStatus(st)}>
                  {st === "live" ? "Publish (live)" : `Mark ${st}`}
                </button>
              ))}
              <button className="btn danger" disabled={!qcRole || !online || d.status === "archived"}
                      onClick={() => setTakedown(true)}>
                Take down…
              </button>
            </div>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Rating</dt>
              <dd>
                <span className="rt">{d.rating}</span>{" "}
                {qcRole ? (
                  <button className="btn s" disabled={!online}
                          onClick={() => { setRating(d.rating); setRateOpen(true); }}>
                    Change…
                  </button>
                ) : null}
              </dd>
              {d.ratingHistory?.by ? (
                <>
                  <dt>Rated by</dt>
                  <dd>
                    {d.ratingHistory.by} · <IsoTime iso={d.ratingHistory.at ?? ""} />
                    <small className="muted"> — {d.ratingHistory.reason}</small>
                  </dd>
                </>
              ) : null}
              <dt>Last content change</dt>
              <dd>{d.updatedAt ? <IsoTime iso={d.updatedAt} /> : <span className="muted">—</span>}</dd>
            </dl>
          </div>
        </div>

        <div className="panel">
          <header>
            <h3>Media health</h3>
            <Sev level={mediaOk ? "ok" : "warn"}>
              {mediaOk ? "complete" : `${d.media.episodes_missing} gap(s)`}
            </Sev>
          </header>
          <div className="acct">
            <dl className="kv">
              <dt>Covers</dt>
              <dd>{d.media.covers_ok ? "9:16 + 16:9 present" : "missing artwork"}</dd>
              <dt>Episodes with HLS</dt>
              <dd className="mono">
                {d.media.episodes_with_media} / {d.episodeCount}
              </dd>
            </dl>
            <img src={d.coverUrl} alt={`${d.title} cover`}
                 style={{ width: 120, borderRadius: 10, marginTop: 8 }}
                 onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <header><h3>Episodes</h3><span className="muted">{d.episodeCount} total · 1–{d.freeEpisodes} free</span></header>
        <table className="table">
          <thead><tr><th>#</th><th>Title</th><th>Access</th></tr></thead>
          <tbody>
            {d.episodes.slice(0, 15).map((e) => (
              <tr key={e.number}>
                <td className="mono">{e.number}</td>
                <td>{e.title}</td>
                <td>{e.isFree ? "Free" : `${d.coinPrice} coins`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.episodeCount > 15 ? (
          <p className="tiny muted" style={{ padding: "0 14px 12px" }}>
            Showing the first 15 — full episode management ships with the content pipeline.
          </p>
        ) : null}
      </div>

      {takedown ? (
        <Modal title={`Take down · ${d.title}`} onClose={() => setTakedown(false)}
               footer={
                 <>
                   <button className="btn s" onClick={() => setTakedown(false)}>Cancel</button>
                   <button className="btn danger" disabled={!reason.trim()}
                           onClick={() => void setStatus("archived", reason.trim())}>
                     Take down now
                   </button>
                 </>
               }>
          <p className="tiny">
            The series disappears from the apps immediately. Viewers keep their coins;
            unlocked episodes stop playing. This is reversible (publish again).
          </p>
          <label>
            Reason (required — reference a grievance id if there is one)
            <input value={reason} onChange={(e) => setReason(e.target.value)}
                   placeholder="e.g. G-4F2A1B legal notice" />
          </label>
        </Modal>
      ) : null}

      {rateOpen ? (
        <Modal title={`Rate · ${d.title}`} onClose={() => setRateOpen(false)}
               footer={
                 <>
                   <button className="btn s" onClick={() => setRateOpen(false)}>Cancel</button>
                   <button className="btn p" disabled={!rateReason.trim()}
                           onClick={() => void applyRating()}>
                     Save rating
                   </button>
                 </>
               }>
          <p className="tiny">
            IT Rules self-classification: the decision, who made it and why are recorded
            and visible on this page. U/A 16+ and A titles ask for the parental PIN.
          </p>
          <label>
            Rating
            <select value={rating} onChange={(e) => setRating(e.target.value)}>
              {RATINGS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label>
            Why (required)
            <input value={rateReason} onChange={(e) => setRateReason(e.target.value)}
                   placeholder="e.g. episode 41 depicts self-harm" />
          </label>
        </Modal>
      ) : null}
    </>
  );
}

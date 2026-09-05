import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api, mutate } from "../api/client";
import type { MediaQcEpisode, MediaQcSeries } from "../api/client";
import { Chip, Empty, IsoTime, Modal, PageHeader, Sev, Skeleton } from "../ui";
import { useStore } from "../store";
import { canAct } from "../auth/roles";

type Filter = "all" | "missing" | "failed";

function keep(e: MediaQcEpisode, filter: Filter): boolean {
  if (filter === "missing") return !e.hasMedia;
  if (filter === "failed") return e.qc.status === "failed";
  return true;
}

/** Per episode: is the HLS rendition on disk, and what did a person say in
 *  QC. Verdicts are audited; a fail always carries a note for the fix crew. */
export function Media() {
  const { role, online, showToast } = useStore();
  const [rows, setRows] = useState<MediaQcSeries[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState("");
  const [failing, setFailing] = useState<{ slug: string; number: number } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void api.mediaQc().then((r) => setRows(r.series));
  }, []);
  useEffect(load, [load]);

  const may = canAct(role, "content,qc") && online;

  const shown = useMemo(() => {
    if (rows === null) return [];
    if (filter === "missing") return rows.filter((s) => s.episodes_missing > 0);
    if (filter === "failed") return rows.filter((s) => s.qc.failed > 0);
    return rows;
  }, [rows, filter]);

  async function verdict(slug: string, number: number, status: "passed" | "failed",
                         why = "") {
    setBusy(true);
    const res = await mutate.setQc(slug, number, status, why);
    setBusy(false);
    if ("offline" in res) return showToast("Offline — verdict not recorded", "error");
    if (res.error) return showToast(`Verdict not recorded: ${res.error}`, "error");
    showToast(`E${number} ${status} · audited`);
    setFailing(null);
    setNote("");
    load();
  }

  return (
    <>
      <PageHeader
        title="Media & QC"
        subtitle="Upload → transcode → package → human QC → ready. Missing renditions and failed QC surface here first; every verdict is audited."
        actions={
          <>
            <Chip on={filter === "all"} onClick={() => setFilter("all")}>All</Chip>
            <Chip on={filter === "missing"} onClick={() => setFilter("missing")}>Missing media</Chip>
            <Chip on={filter === "failed"} onClick={() => setFilter("failed")}>Failed QC</Chip>
          </>
        }
      />

      {rows === null ? (
        <Skeleton rows={6} />
      ) : shown.length === 0 ? (
        <Empty title="Nothing to fix"
               hint="Every episode has media and no QC failure under this filter." />
      ) : (
        <div className="panel">
          <table className="table">
            <thead>
              <tr><th>Series</th>
                  <th style={{ textAlign: "right" }}>Episodes</th>
                  <th style={{ textAlign: "right" }}>With media</th>
                  <th style={{ textAlign: "right" }}>Missing</th>
                  <th>QC</th><th aria-label="expand"></th></tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                // The episode table is a sibling row spanning all six columns —
                // nested inside the Series <td> it overflowed the page and left
                // the series' own cells floating mid-list (ADM-05).
                <Fragment key={s.slug}>
                <tr>
                  <td>
                    <b>{s.title}</b>
                    <small className="muted mono"> {s.slug}</small>
                  </td>
                  <td style={{ textAlign: "right" }} className="mono">{s.episodeCount}</td>
                  <td style={{ textAlign: "right" }} className="mono">{s.episodes_with_media}</td>
                  <td style={{ textAlign: "right" }}>
                    {s.episodes_missing === 0
                      ? <Sev level="ok">0</Sev>
                      : <Sev level="warn">{s.episodes_missing}</Sev>}
                  </td>
                  <td>
                    <span className="tiny mono">
                      {s.qc.passed} pass · {s.qc.pending} pending ·{" "}
                      {s.qc.failed > 0 ? <Sev level="danger">{s.qc.failed} failed</Sev> : "0 failed"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn s" aria-label={`Episodes of ${s.title}`}
                            onClick={() => setOpen(open === s.slug ? "" : s.slug)}>
                      {open === s.slug ? "Hide" : "Episodes"}
                    </button>
                  </td>
                </tr>
                {open === s.slug ? (
                  <tr className="epsrow">
                    <td colSpan={6}>
                      <div className="tablewrap">
                      <table className="table">
                        <thead><tr><th>#</th><th>Title</th><th>Media</th><th>QC</th>
                                   <th aria-label="verdict"></th></tr></thead>
                        <tbody>
                          {s.episodes.filter((e) => keep(e, filter)).map((e) => (
                            <tr key={e.number}>
                              <td className="mono">{e.number}</td>
                              <td>{e.title}</td>
                              <td>{e.hasMedia
                                ? <Sev level="ok">HLS</Sev>
                                : <Sev level="warn">no media</Sev>}</td>
                              <td>
                                <Sev level={e.qc.status === "passed" ? "ok"
                                  : e.qc.status === "failed" ? "danger" : "info"}>
                                  {e.qc.status}
                                </Sev>
                                {e.qc.by ? (
                                  <small className="muted tiny">
                                    {" "}{e.qc.by} · <IsoTime iso={e.qc.at} />
                                    {e.qc.note ? ` — ${e.qc.note}` : ""}
                                  </small>
                                ) : null}
                              </td>
                              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                <button className="btn s" disabled={!may || busy}
                                        aria-label={`Pass E${e.number}`}
                                        onClick={() => void verdict(s.slug, e.number, "passed")}>
                                  Pass
                                </button>{" "}
                                <button className="btn danger" disabled={!may || busy}
                                        aria-label={`Fail E${e.number}`}
                                        onClick={() => { setNote(""); setFailing({ slug: s.slug, number: e.number }); }}>
                                  Fail…
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {failing ? (
        <Modal title={`Fail QC · ${failing.slug} E${failing.number}`}
               onClose={() => setFailing(null)}
               footer={
                 <>
                   <button className="btn s" onClick={() => setFailing(null)}>Cancel</button>
                   <button className="btn danger" disabled={busy || !note.trim()}
                           onClick={() => void verdict(failing.slug, failing.number,
                                                       "failed", note.trim())}>
                     Record failure
                   </button>
                 </>
               }>
          <p className="tiny">
            The fix crew reads this note, not your memory: say what is wrong and where.
          </p>
          <label>
            What failed (required)
            <input value={note} onChange={(e) => setNote(e.target.value)}
                   aria-label="QC note" placeholder="e.g. audio drops at 00:41" />
          </label>
        </Modal>
      ) : null}
    </>
  );
}

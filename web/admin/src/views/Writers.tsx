import { useCallback, useEffect, useState } from "react";
import { api, mutate } from "../api/client";
import type { Outline, WritersRow, WritersWorkspace } from "../api/client";
import { Empty, IsoTime, PageHeader, Sev, Skeleton } from "../ui";
import { useStore } from "../store";
import { canAct } from "../auth/roles";

export const MAX_ITEMS = 200;

// Local beat template — no model is called. The helper only fills episodes
// that have no beat yet, so a writer's own words are never overwritten.
const TEMPLATE = [
  "Open on the wound: what the lead wants and cannot have",
  "A promise made — and a rival who sees it",
  "The first door closes; a secret keeps it shut",
  "Reversal: the ally was never one",
  "The cliff: she chooses, and it costs her",
];

export function draftOutline(count: number, existing: Outline[]): Outline[] {
  const n = Math.min(count, MAX_ITEMS);
  const have = new Map(existing.map((o) => [o.number, o.beat]));
  return Array.from({ length: n }, (_, i) => {
    const number = i + 1;
    const cur = have.get(number);
    if (cur) return { number, beat: cur };
    const act = number === 1 ? "Pilot" : number === n ? "Finale"
      : `Act ${Math.floor((i * 3) / n) + 1}`;
    return { number, beat: `${act}: ${TEMPLATE[i % TEMPLATE.length]}` };
  });
}

interface Draft { logline: string; hooks: string; outlines: Outline[]; notes: string }

function toDraft(ws: WritersWorkspace): Draft {
  return { logline: ws.logline, hooks: ws.hooks.join("\n"),
           outlines: ws.episode_outlines, notes: ws.notes };
}

/** Per-series writers' workspace: logline, hooks, episode beats, notes.
 *  Drafting help is a local template (stated in the UI) — nothing leaves. */
export function Writers() {
  const { role, online, showToast } = useStore();
  const [index, setIndex] = useState<WritersRow[] | null>(null);
  const [slug, setSlug] = useState("");
  // undefined = loading, null = unavailable (unknown series / unreachable)
  const [edit, setEdit] = useState<{ ws: WritersWorkspace; d: Draft } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const loadIndex = useCallback(() => {
    void api.writersIndex().then((r) => setIndex(r.series));
  }, []);
  useEffect(loadIndex, [loadIndex]);

  const open = useCallback((s: string) => {
    setSlug(s);
    setEdit(undefined);
    void api.writersWorkspace(s).then((w) => {
      setEdit(w ? { ws: w, d: toDraft(w) } : null);
    });
  }, []);

  const setD = (d: Draft) => setEdit((cur) => ({ ws: cur!.ws, d }));

  const may = canAct(role, "content") && online;

  async function save() {
    if (!edit) return;
    const { d } = edit;
    setBusy(true);
    const res = await mutate.saveWriters(slug, {
      logline: d.logline.trim(),
      hooks: d.hooks.split("\n").map((h) => h.trim()).filter(Boolean),
      episode_outlines: d.outlines,
      notes: d.notes.trim(),
    });
    setBusy(false);
    if ("offline" in res) return showToast("Offline — workspace not saved", "error");
    if (res.error) return showToast(`Not saved: ${res.error}`, "error");
    showToast(`Workspace saved · ${String(res.completeness_pct)}% complete · audited`);
    const saved = res as unknown as WritersWorkspace;
    setEdit({ ws: saved, d: toDraft(saved) });   // the server's answer, not the local draft
    loadIndex();
  }

  return (
    <>
      <PageHeader
        title="AI Writers’ Room"
        subtitle="Logline, hooks and episode beats per series with a human decision at every gate. The draft helper is a local template — no external model is called."
      />
      <div className="split">
        <div className="panel">
          <header><h3>Series</h3>
            <span className="muted">{index ? `${index.length} workspaces` : "…"}</span></header>
          {index === null ? <Skeleton rows={5} /> : index.length === 0 ? (
            <Empty title="No series" hint="Draft a series in the catalog first." />
          ) : (
            <ul className="approvals">
              {index.map((r) => (
                <li key={r.slug} className="aprow">
                  <div style={{ flex: 1 }}>
                    <b>{r.title}</b>
                    <div className="tiny muted">
                      {r.hooks} hooks · {r.outlines}/{r.episodeCount} beats
                      {r.by ? <> · {r.by} <IsoTime iso={r.updated_at} /></> : null}
                    </div>
                  </div>
                  <Sev level={r.completeness_pct >= 75 ? "ok" : r.completeness_pct > 0 ? "info" : "warn"}>
                    {r.completeness_pct}%
                  </Sev>
                  <button className={slug === r.slug ? "btn p" : "btn s"}
                          onClick={() => open(r.slug)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          {!slug ? (
            <Empty title="Pick a series" hint="Its workspace opens here." />
          ) : edit === undefined ? (
            <Skeleton rows={6} />
          ) : edit === null ? (
            <Empty title="Workspace unavailable"
                   hint="The series is unknown or the server did not answer — nothing to edit." />
          ) : (
            <>
              {(({ ws, d }) => (
              <>
              <header>
                <h3>{ws.title}</h3>
                <span className="muted">{ws.completeness_pct}% complete
                  {ws.by ? <> · last saved by {ws.by}</> : null}</span>
              </header>
              <div className="acct">
                <label>
                  Logline
                  <input value={d.logline} aria-label="Logline" maxLength={2000}
                         onChange={(e) => setD({ ...d, logline: e.target.value })}
                         placeholder="One sentence: who wants what, and what stands in the way" />
                </label>
                <label>
                  Hooks (one per line)
                  <textarea value={d.hooks} aria-label="Hooks" rows={4}
                            onChange={(e) => setD({ ...d, hooks: e.target.value })} />
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0 6px" }}>
                  <b>Episode beats</b>
                  <span className="muted tiny">{d.outlines.length}/{ws.episodeCount}</span>
                  <span className="sp" style={{ flex: 1 }} />
                  <button className="btn s"
                          title="Fills empty beats from a local template. No AI call."
                          onClick={() => setD({ ...d, outlines: draftOutline(ws.episodeCount, d.outlines) })}>
                    Draft outline (local template)
                  </button>
                  <button className="btn s" disabled={d.outlines.length >= Math.min(ws.episodeCount, MAX_ITEMS)}
                          onClick={() => setD({ ...d, outlines: [...d.outlines,
                            { number: d.outlines.length + 1, beat: "" }] })}>
                    Add beat
                  </button>
                </div>
                <table className="table">
                  <tbody>
                    {d.outlines.map((o, i) => (
                      <tr key={i}>
                        <td className="mono" style={{ width: 40 }}>E{o.number}</td>
                        <td>
                          <input value={o.beat} aria-label={`Beat ${o.number}`} maxLength={2000}
                                 style={{ width: "100%" }}
                                 onChange={(e) => setD({ ...d, outlines: d.outlines.map((o, j) =>
                                   (j === i ? { ...o, beat: e.target.value } : o)) })} />
                        </td>
                        <td style={{ width: 40 }}>
                          <button className="btn s" aria-label={`Remove beat ${o.number}`}
                                  onClick={() => setD({ ...d, outlines: d.outlines.filter((_, j) => j !== i) })}>
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <label>
                  Notes
                  <textarea value={d.notes} aria-label="Notes" rows={3}
                            onChange={(e) => setD({ ...d, notes: e.target.value })} />
                </label>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                  <button className="btn p" disabled={!may || busy} onClick={() => void save()}>
                    Save workspace
                  </button>
                </div>
              </div>
              </>
              ))(edit)}
            </>
          )}
        </div>
      </div>
    </>
  );
}

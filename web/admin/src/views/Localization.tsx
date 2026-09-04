import { useCallback, useEffect, useState } from "react";
import { api, mutate } from "../api/client";
import type { LocSeries, LocStatus } from "../api/client";
import { Empty, Modal, PageHeader, Skeleton } from "../ui";
import { useStore } from "../store";
import { canAct } from "../auth/roles";

const LANG_NAMES: Record<string, string> = { hi: "Hindi", ta: "Tamil", te: "Telugu" };
const STATUS_LABEL: Record<LocStatus, string> = {
  none: "—", in_progress: "in progress", done: "done",
};

interface Edit { slug: string; title: string; lang: string; kind: string;
                 status: LocStatus; owner: string; due: string }

/** Series × language: dub and subtitle status with an owner and a due date. */
export function Localization() {
  const { role, online, showToast } = useStore();
  const [data, setData] = useState<{ series: LocSeries[]; languages: string[];
                                     kinds: string[] } | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { void api.localization().then(setData); }, []);
  useEffect(load, [load]);

  const may = canAct(role, "content") && online;

  async function save() {
    if (!edit) return;
    setBusy(true);
    const res = await mutate.setLocalization(edit.slug, {
      lang: edit.lang, kind: edit.kind, status: edit.status,
      owner: edit.owner.trim(), due: edit.due.trim(),
    });
    setBusy(false);
    if ("offline" in res) return showToast("Offline — nothing saved", "error");
    if (res.error) return showToast(`Not saved: ${res.error}`, "error");
    showToast(`${edit.title} · ${LANG_NAMES[edit.lang]} ${edit.kind} → ${edit.status} · audited`);
    setEdit(null);
    load();
  }

  if (data === null) return <Skeleton rows={6} />;

  return (
    <>
      <PageHeader
        title="Localization"
        subtitle="Dubs and subtitles per language. A native speaker reviews the first three episodes of every series; owners and due dates keep the plan honest."
      />
      {data.series.length === 0 ? (
        <Empty title="No series yet" hint="Draft a series in the catalog and its language grid appears here." />
      ) : (
        <div className="panel">
          <div className="tablewrap">
            <table className="table mtx">
              <thead>
                <tr>
                  <th>Series</th>
                  {data.languages.map((l) => <th key={l}>{LANG_NAMES[l]}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.series.map((s) => (
                  <tr key={s.slug}>
                    <td><b>{s.title}</b><small className="muted"> · {s.language}</small></td>
                    {data.languages.map((l) => (
                      <td key={l}>
                        {data.kinds.map((k) => {
                          const c = s.langs[l][k];
                          return (
                            <button key={k} type="button" className={`chip c-${c.status}`}
                                    disabled={!may}
                                    title={c.owner ? `${c.owner}${c.due ? ` · due ${c.due}` : ""}` : "unassigned"}
                                    aria-label={`${s.title} ${LANG_NAMES[l]} ${k}`}
                                    onClick={() => setEdit({ slug: s.slug, title: s.title, lang: l,
                                                             kind: k, status: c.status,
                                                             owner: c.owner, due: c.due })}>
                              {k} {STATUS_LABEL[c.status]}
                            </button>
                          );
                        })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {edit ? (
        <Modal title={`${edit.title} · ${LANG_NAMES[edit.lang]} ${edit.kind}`}
               onClose={() => setEdit(null)}
               footer={
                 <>
                   <button className="btn s" onClick={() => setEdit(null)}>Cancel</button>
                   <button className="btn p" disabled={busy} onClick={() => void save()}>
                     Save
                   </button>
                 </>
               }>
          <label>
            Status
            <select value={edit.status} aria-label="Status"
                    onChange={(e) => setEdit({ ...edit, status: e.target.value as LocStatus })}>
              <option value="none">not started</option>
              <option value="in_progress">in progress</option>
              <option value="done">done</option>
            </select>
          </label>
          <div className="frow">
            <label>
              Owner
              <input value={edit.owner} aria-label="Owner"
                     onChange={(e) => setEdit({ ...edit, owner: e.target.value })}
                     placeholder="e.g. Priya (studio)" />
            </label>
            <label>
              Due (YYYY-MM-DD)
              <input value={edit.due} aria-label="Due"
                     onChange={(e) => setEdit({ ...edit, due: e.target.value })}
                     placeholder="2026-10-01" />
            </label>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

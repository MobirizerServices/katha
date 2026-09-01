import { useCallback, useEffect, useState } from "react";
import { api, mutate } from "../api/client";
import type { Grievance } from "../api/client";
import { Empty, IsoTime, Modal, PageHeader, Sev, Skeleton } from "../ui";
import { useStore } from "../store";
import { canAct } from "../auth/roles";

const FILTERS = ["all", "new", "ack", "resolved"] as const;

export function Grievances() {
  const { role, online, showToast, refreshSignals } = useStore();
  const [rows, setRows] = useState<Grievance[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [resolving, setResolving] = useState<Grievance | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    void api.grievances().then((r) => setRows(r.grievances));
  }, []);
  useEffect(load, [load]);

  const may = canAct(role, "support");

  async function ack(g: Grievance) {
    const res = await mutate.grievanceAck(g.id);
    if ("offline" in res) return showToast("Offline — not acknowledged", "error");
    if (res.error) return showToast(res.error, "error");
    showToast(`${g.id} acknowledged · assigned to you`);
    load();
    refreshSignals();
  }

  async function resolve() {
    if (!resolving || !note.trim()) return;
    const res = await mutate.grievanceResolve(resolving.id, note.trim());
    if ("offline" in res) return showToast("Offline — not resolved", "error");
    if (res.error) return showToast(res.error, "error");
    showToast(`${resolving.id} resolved · complainant should be informed at ${resolving.contact}`);
    setResolving(null);
    setNote("");
    load();
    refreshSignals();
  }

  const shown = (rows ?? []).filter((g) => filter === "all" || g.status === filter);

  return (
    <>
      <PageHeader
        title="Grievances"
        subtitle="IT Rules 2021: acknowledge within 24 hours, resolve within 15 days. Tickets arrive from the app and web Help pages; every transition is audited."
      />

      <div className="tabs" role="tablist">
        {FILTERS.map((f) => (
          <button key={f} role="tab" aria-selected={filter === f}
                  className={filter === f ? "tab on" : "tab"} onClick={() => setFilter(f)}>
            {f === "all" ? `All${rows ? ` (${rows.length})` : ""}` : f}
          </button>
        ))}
      </div>

      {rows === null ? (
        <Skeleton rows={4} />
      ) : shown.length === 0 ? (
        <Empty
          title={filter === "all" ? "No grievances" : `Nothing ${filter}`}
          hint="New complaints appear here the moment a user files one from Help."
        />
      ) : (
        <ul className="approvals">
          {shown.map((g) => (
            <li key={g.id} className="aprow">
              <div style={{ flex: 1 }}>
                <b className="mono">{g.id}</b>
                <Sev level={g.status === "resolved" ? "ok" : g.ack_breach || g.resolve_breach ? "danger" : g.status === "new" ? "warn" : "info"}>
                  {g.status === "new" && g.ack_breach ? "ACK OVERDUE"
                    : g.resolve_breach ? "15d BREACH" : g.status}
                </Sev>
                <span className="muted"> · {g.channel} · {g.contact}</span>
                <div><b>{g.subject}</b></div>
                {g.body ? <div className="muted tiny">{g.body}</div> : null}
                <div className="tiny muted">
                  filed <IsoTime iso={g.created_at} />
                  {g.assignee ? ` · assignee ${g.assignee}` : " · unassigned"}
                  {g.ack_at ? <> · acked <IsoTime iso={g.ack_at} /></> : null}
                  {g.resolved_at ? <> · resolved <IsoTime iso={g.resolved_at} /></> : null}
                </div>
                {g.notes.length > 0 ? (
                  <ul className="tl tiny">
                    {g.notes.map((n, i) => (
                      <li key={i}><b>{n.by}</b>: {n.note}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {g.status === "new" ? (
                <button className="btn p" disabled={!may || !online} onClick={() => void ack(g)}>
                  Acknowledge
                </button>
              ) : null}
              {g.status !== "resolved" ? (
                <button className="btn s" disabled={!may || !online}
                        onClick={() => { setResolving(g); setNote(""); }}>
                  Resolve…
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="tiny muted">
        The grievance officer of record must be a named person before public beta —
        this queue gives them the tool, not the title.
      </p>

      {resolving ? (
        <Modal title={`Resolve · ${resolving.id}`} onClose={() => setResolving(null)}
               footer={
                 <>
                   <button className="btn s" onClick={() => setResolving(null)}>Cancel</button>
                   <button className="btn p" disabled={!note.trim()} onClick={() => void resolve()}>
                     Mark resolved
                   </button>
                 </>
               }>
          <p className="tiny">
            What was done? The note is audited and should be shared with the complainant.
          </p>
          <label>
            Resolution note (required)
            <input value={note} onChange={(e) => setNote(e.target.value)}
                   placeholder="e.g. duplicate charge refunded, order id …" />
          </label>
        </Modal>
      ) : null}
    </>
  );
}

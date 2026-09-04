import { useCallback, useEffect, useState } from "react";
import { api, mutate } from "../api/client";
import { useStore } from "../store";
import { Empty, IsoTime, PageHeader, Sev, Skeleton } from "../ui";

type Row = {
  id: number; kind: string; recipient: string; subject: string;
  body: string; status: string; detail: string; created_at: string;
};

/** Every email + push the system produced, whatever the transport (comms are
 * outbox-first). Dev shows queued rows; production shows sent/failed truth.
 * Comms only: the invoice register lives on the Finance view. */
export function Outbox() {
  const { role, online, showToast } = useStore();
  const [kind, setKind] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [transports, setTransports] = useState({ email: false, push: false });
  const [open, setOpen] = useState<number | null>(null);
  const [retrying, setRetrying] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await api.outbox(kind);
    setRows(r.rows);
    setTransports(r.transports);
  }, [kind]);
  useEffect(() => { void load(); }, [load]);

  const canRetry = role === "admin" || role === "support";

  async function retry(id: number) {
    setRetrying(id);
    const res = await mutate.outboxRetry(id);
    setRetrying(null);
    if ("offline" in res) return showToast("Offline — nothing re-sent", "error");
    if (res.error) return showToast(`Retry refused: ${res.error}`, "error");
    if (res.status === "sent") showToast(`#${id} delivered · audited`);
    else showToast(`#${id} failed again: ${res.detail}`, "error");
    void load();
  }

  const sev = (s: string) =>
    s === "sent" ? "ok" : s === "failed" ? "danger" : "info";

  return (
    <>
      <PageHeader
        title="Outbox"
        subtitle="Outbound comms are written here BEFORE any delivery attempt — this list is the complete record of what the system said to whom."
        actions={
          <span className="muted tiny">
            transports: email {transports.email ? "configured" : "dev (queued only)"} ·
            push {transports.push ? "APNs" : "dev (queued only)"}
          </span>
        }
      />
      <div className="filters">
        <select value={kind} onChange={(e) => setKind(e.target.value)}
                aria-label="Kind">
          <option value="">Email + push</option>
          <option value="email">Email</option>
          <option value="push">Push</option>
        </select>
      </div>
      {rows === null ? (
        <Skeleton rows={5} />
      ) : rows.length === 0 ? (
        <Empty title="Nothing sent yet"
               hint="Invoices, grievance replies and episode-drop pushes land here the moment they are produced." />
      ) : (
        <div className="panel">
          <table className="table">
            <thead>
              <tr><th>#</th><th>Kind</th><th>To</th><th>Subject</th>
                  <th>Status</th><th>When</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)}
                    style={{ cursor: "pointer" }}>
                  <td className="mono muted">{r.id}</td>
                  <td>{r.kind}</td>
                  <td className="mono">{r.recipient}</td>
                  <td>
                    {r.subject || "—"}
                    {r.detail ? (
                      <div className="tiny muted">{r.detail}</div>
                    ) : null}
                    {open === r.id ? (
                      <div className="tiny mono" style={{ marginTop: 6,
                            whiteSpace: "pre-wrap", maxWidth: 520,
                            maxHeight: 200, overflow: "auto" }}>
                        {r.body}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <Sev level={sev(r.status)}>{r.status}</Sev>
                    {canRetry && r.kind === "email" && r.status !== "sent" ? (
                      <button className="btn s" style={{ marginLeft: 8 }}
                              disabled={!online || retrying === r.id}
                              title={transports.email
                                ? "Attempt delivery again over SMTP"
                                : "Needs KATHA_SMTP_URL — dev has no transport"}
                              onClick={(e) => { e.stopPropagation(); void retry(r.id); }}>
                        {retrying === r.id ? "Retrying…" : "Retry"}
                      </button>
                    ) : null}
                  </td>
                  <td><IsoTime iso={r.created_at} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="tiny muted">
        The GST invoice register moved to <a href="#/finance">Finance</a> — this
        list is comms only.
      </p>
    </>
  );
}

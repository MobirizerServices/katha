import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { Empty, IsoTime, PageHeader, Sev, Skeleton } from "../ui";

type Row = {
  id: number; kind: string; recipient: string; subject: string;
  body: string; status: string; detail: string; created_at: string;
};

/** Every email + push the system produced, whatever the transport (comms are
 * outbox-first). Dev shows queued rows; production shows sent/failed truth. */
export function Outbox() {
  const [kind, setKind] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [transports, setTransports] = useState({ email: false, push: false });
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await api.outbox(kind);
    setRows(r.rows);
    setTransports(r.transports);
  }, [kind]);
  useEffect(() => { void load(); }, [load]);

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
                  <td><Sev level={sev(r.status)}>{r.status}</Sev></td>
                  <td><IsoTime iso={r.created_at} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

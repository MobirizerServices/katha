import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { AuditEntry } from "../api/types";
import { Empty, IsoTime, PageHeader, Skeleton } from "../ui";
import { useStore } from "../store";

function renderChange(change: string) {
  // "from=X, to=Y" renders as a diff (#072); everything else verbatim.
  const m = /(?:^|, )from=([^,]*), to=(.*)$/.exec(change);
  if (m) {
    return (
      <span>
        <s className="muted">{m[1]}</s> → <b>{m[2]}</b>
      </span>
    );
  }
  return <span>{change}</span>;
}

function toCsv(rows: AuditEntry[]): string {
  const head = "id,ts,actor,action,entity,change,ip";
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  return [head, ...rows.map((r) =>
    [r.id ?? "", r.ts, r.actor, r.action, r.entity, r.change, r.ip ?? ""].map(esc).join(",")
  )].join("\n");
}

export function Audit() {
  const { showToast } = useStore();
  const [params] = useSearchParams();
  const [actor, setActor] = useState("");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [chainOk, setChainOk] = useState(true);
  const [total, setTotal] = useState(0);

  const load = useCallback(async (before?: number) => {
    const page = await api.listAudit({ actor, q, limit: 100, before });
    setChainOk(page.chain_ok);
    setTotal(page.total);
    setRows((prev) => (before ? [...(prev ?? []), ...page.rows] : page.rows));
  }, [actor, q]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  function exportCsv() {
    if (!rows || rows.length === 0) return;
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `katha-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`Audit log exported · ${rows.length} rows`);
  }

  const oldest = rows && rows.length > 0 ? rows[rows.length - 1].id : undefined;

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle={
          <>
            Every admin mutation, hash-chained and immutable.{" "}
            <span className={chainOk ? "chain ok" : "chain bad"}>
              {chainOk ? "chain verified" : "CHAIN BROKEN — investigate"}
            </span>
          </>
        }
        actions={
          <button className="btn s" onClick={exportCsv} disabled={!rows || rows.length === 0}>
            Export CSV ({rows?.length ?? 0})
          </button>
        }
      />

      <div className="filters">
        <input placeholder="Actor…" value={actor} onChange={(e) => setActor(e.target.value)}
               aria-label="Filter by actor" />
        <input placeholder="Entity or action…" value={q} onChange={(e) => setQ(e.target.value)}
               aria-label="Filter by entity or action" />
      </div>

      {rows === null ? (
        <Skeleton rows={5} />
      ) : rows.length === 0 ? (
        <Empty title="No entries" hint="Adjust your filters — every mutation writes a row here." />
      ) : (
        <>
          <table className="table audit">
            <thead>
              <tr>
                <th>#</th><th>When</th><th>Actor</th><th>Action</th>
                <th>Entity</th><th>Change</th><th>IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id ?? i}>
                  <td className="mono muted">{r.id ?? "—"}</td>
                  <td>{typeof r.ts === "string"
                    ? <IsoTime iso={r.ts} />
                    : <IsoTime iso={new Date(r.ts).toISOString()} />}</td>
                  <td>{r.actor}</td>
                  <td className="mono">{r.action}</td>
                  <td className="mono">{r.entity}</td>
                  <td>{renderChange(r.change)}</td>
                  <td className="mono muted">{r.ip || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length < total && oldest ? (
            <button className="btn s" style={{ margin: "12px 0" }}
                    onClick={() => void load(oldest)}>
              Load older ({total - rows.length} more)
            </button>
          ) : null}
        </>
      )}
      <p className="tiny muted">
        Append-only. Rows are never edited or deleted; corrections are written as new
        entries. Each row's hash covers everything before it.
      </p>
    </>
  );
}

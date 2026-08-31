import { useMemo, useState } from "react";
import { PageHeader, tsLabel } from "../ui";
import { useStore } from "../store";

export function Audit() {
  const { audit, showToast } = useStore();
  const [actor, setActor] = useState("");
  const [entity, setEntity] = useState("");

  const rows = useMemo(() => {
    const a = actor.trim().toLowerCase();
    const e = entity.trim().toLowerCase();
    return audit.filter(
      (r) =>
        (!a || r.actor.toLowerCase().includes(a)) &&
        (!e || r.entity.toLowerCase().includes(e) || r.action.toLowerCase().includes(e))
    );
  }, [audit, actor, entity]);

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every admin mutation, immutable. Filter by actor, entity or action; export for compliance reviews."
        actions={
          <button className="btn s" onClick={() => showToast(`Audit log exported · ${rows.length} rows`)}>
            Export CSV ({rows.length})
          </button>
        }
      />

      <div className="filters">
        <div className="search" style={{ width: 240, maxWidth: 240 }}>
          <span>⌕</span>
          <input placeholder="Actor…" value={actor} onChange={(e) => setActor(e.target.value)} />
        </div>
        <div className="search" style={{ width: 240, maxWidth: 240 }}>
          <span>⌕</span>
          <input
            placeholder="Entity or action…"
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
          />
        </div>
      </div>

      <div className="panel">
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr>
                <th style={{ width: 210 }}>When (UTC)</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.ts}-${i}`}>
                  <td className="mono">{tsLabel(r.ts)}</td>
                  <td>{r.actor}</td>
                  <td>
                    <span className="mono">{r.action}</span>
                  </td>
                  <td>{r.entity}</td>
                  <td className="muted">{r.change}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty">
                      <h4>No entries</h4>
                      <p>Adjust your filters.</p>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <p className="tiny" style={{ marginTop: 10 }}>
        Append-only. Rows are never edited or deleted; corrections are written as new entries.
      </p>
    </>
  );
}

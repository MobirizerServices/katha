import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { Approval } from "../api/types";
import { Empty, IsoTime, Modal, PageHeader, Sev, fmtN } from "../ui";
import { useStore } from "../store";
import { canAct } from "../auth/roles";

function ageHours(when: string): number | null {
  const t = Date.parse(when);
  return Number.isNaN(t) ? null : (Date.now() - t) / 36e5;
}

export function Approvals() {
  const { role, me, online, approvals, reloadApprovals, resolveApproval, showToast } = useStore();
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [history, setHistory] = useState<Approval[]>([]);
  const [rejecting, setRejecting] = useState<Approval[] | null>(null);
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [threshold, setThreshold] = useState(500);

  useEffect(() => {
    void api.policy().then((p) => setThreshold(p.dual_approval_threshold));
  }, []);
  useEffect(() => {
    if (tab === "history") void api.listApprovals("all").then(setHistory);
  }, [tab, approvals.length]);

  const canDecide = canAct(role, "finance");
  const rows = tab === "pending" ? approvals : history.filter((a) => a.status !== "pending");

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function decide(list: Approval[], decision: "approved" | "rejected", withNote = "") {
    let ok = 0;
    let offline = 0;
    for (const a of list) {
      if (decision === "approved" && a.requestedBy === me) {
        showToast("You can't approve your own request", "error");
        continue;
      }
      const res = await resolveApproval(a.id, decision, me, withNote);
      if ("offline" in res) offline += 1;
      else if (res.error) showToast(`${a.id}: ${res.error}`, "error");
      else ok += 1;
    }
    // Say only what actually happened: a failed batch is not "written".
    if (ok > 0) {
      showToast(decision === "approved"
        ? `Approved ${ok > 1 ? `${ok} requests` : ""} · change written to the ledger`
        : `Rejected ${ok > 1 ? `${ok} requests` : ""} · returned to requester with your note`);
    } else if (offline > 0) {
      showToast("Offline — nothing was decided", "error");
    }
    setPicked(new Set());
    setRejecting(null);
    setNote("");
    if (online) void reloadApprovals();      // offline: local resolution stands
  }

  const pickedRows = useMemo(
    () => rows.filter((a) => picked.has(a.id)), [rows, picked]);

  return (
    <>
      <PageHeader
        title="Approvals inbox"
        subtitle={`Coin adjustments above ${fmtN(threshold)} need a second person. Approving writes the change; rejecting returns it with your note. Requesters can never approve their own.`}
        actions={
          pickedRows.length > 1 ? (
            <button className="btn s" onClick={() => setRejecting(pickedRows)}>
              Reject {pickedRows.length} with one note
            </button>
          ) : undefined
        }
      />

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "pending"}
                className={tab === "pending" ? "tab on" : "tab"}
                onClick={() => setTab("pending")}>
          Pending{approvals.length ? ` (${approvals.length})` : ""}
        </button>
        <button role="tab" aria-selected={tab === "history"}
                className={tab === "history" ? "tab on" : "tab"}
                onClick={() => setTab("history")}>
          History
        </button>
      </div>

      {rows.length === 0 ? (
        <Empty
          title={tab === "pending" ? "Inbox zero" : "No decisions yet"}
          hint={tab === "pending"
            ? `Requests above ${fmtN(threshold)} coins land here for a second pair of eyes.`
            : "Approved and rejected requests will appear here with their outcomes."}
        />
      ) : (
        <ul className="approvals">
          {rows.map((a) => {
            const h = ageHours(a.when);
            const sev = h === null ? null : h > 24 ? "danger" : h > 4 ? "warn" : "ok";
            return (
              <li key={a.id} className="aprow">
                {tab === "pending" ? (
                  <input type="checkbox" checked={picked.has(a.id)}
                         onChange={() => togglePick(a.id)}
                         aria-label={`Select ${a.id}`} />
                ) : null}
                <div style={{ flex: 1 }}>
                  <b>{a.kind}</b>
                  {a.status && a.status !== "pending" ? (
                    <Sev level={a.status === "approved" ? "ok" : "warn"}> {a.status}</Sev>
                  ) : null}
                  <span className="muted"> · requested by {a.requestedBy}</span>
                  {typeof a.requesterToday === "number" && a.requesterToday > 1 ? (
                    <span className="muted"> ({a.requesterToday} requests today)</span>
                  ) : null}
                  <div className="muted">{a.detail}</div>
                  {a.balanceBefore != null ? (
                    <div className="tiny mono">
                      balance {fmtN(a.balanceBefore)} → {fmtN(a.balanceAfter ?? 0)}
                    </div>
                  ) : null}
                  <div className="tiny muted">
                    <IsoTime iso={a.when} />{" "}
                    {sev ? <Sev level={sev}>{h! > 24 ? "SLA breach" : `${Math.round(h!)}h old`}</Sev> : null}
                    {a.approvedBy ? ` · decided by ${a.approvedBy}` : null}
                  </div>
                </div>
                {tab === "pending" ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn s" disabled={!canDecide || !online}
                            onClick={() => setRejecting([a])}>
                      Reject
                    </button>
                    <button className="btn p"
                            disabled={!canDecide || !online || a.requestedBy === me}
                            title={a.requestedBy === me ? "Requester cannot self-approve" : ""}
                            onClick={() => void decide([a], "approved")}>
                      Approve
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {rejecting ? (
        <Modal
          title={rejecting.length === 1
            ? `Reject · ${rejecting[0].id}` : `Reject ${rejecting.length} requests`}
          onClose={() => setRejecting(null)}
          footer={
            <>
              <button className="btn s" onClick={() => setRejecting(null)}>Cancel</button>
              <button className="btn danger" disabled={!note.trim()}
                      onClick={() => void decide(rejecting, "rejected", note.trim())}>
                Reject with note
              </button>
            </>
          }
        >
          <p className="tiny">The requester sees this note — say what to fix.</p>
          <label>
            Note (required)
            <input value={note} onChange={(e) => setNote(e.target.value)}
                   placeholder="e.g. use the refund flow for this, not goodwill" />
          </label>
        </Modal>
      ) : null}
    </>
  );
}

import { PageHeader } from "../ui";
import { ME, useStore } from "../store";
import { ROLE_NAMES, canAct } from "../auth/roles";

export function Approvals() {
  const { approvals, resolveApproval, showToast, role } = useStore();
  const mayDecide = canAct(role, "finance");

  function decide(id: string, requestedBy: string, decision: "approved" | "rejected") {
    // The requester can never approve their own request (four-eyes / dual
    // control). Rejecting is always allowed; approving your own is blocked.
    if (decision === "approved" && requestedBy === ME) {
      showToast("You can't approve your own request — a second person must.");
      return;
    }
    if (!mayDecide) {
      showToast(`${ROLE_NAMES[role]} can't decide approvals.`);
      return;
    }
    resolveApproval(id, decision, ME);
    showToast(
      decision === "approved"
        ? "Approved · change written to the ledger"
        : "Rejected · returned to requester with your note"
    );
  }

  return (
    <>
      <PageHeader
        title="Approvals inbox"
        subtitle={`${approvals.length} requests need a second person. Approving writes the change; rejecting returns it with your note.`}
      />

      <div className="panel">
        {approvals.length ? (
          <div className="alerts">
            {approvals.map((a) => {
              const isOwn = a.requestedBy === ME;
              return (
                <div className="alert" key={a.id}>
                  <span className="dot" style={{ background: "var(--warn)" }} />
                  <div style={{ flex: 1 }}>
                    <b>
                      {a.kind}{" "}
                      <span className="tiny">
                        · requested by {a.requestedBy} · {a.when} · needs {a.needs}
                      </span>
                    </b>
                    <span className="muted">{a.detail}</span>
                    {isOwn ? (
                      <div className="tiny" style={{ color: "var(--warn)", marginTop: 4 }}>
                        You requested this — you can't approve it yourself.
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button
                      className="btn s sm"
                      onClick={() => decide(a.id, a.requestedBy, "rejected")}
                      disabled={!mayDecide}
                    >
                      Reject
                    </button>
                    <button
                      className="btn g sm"
                      onClick={() => decide(a.id, a.requestedBy, "approved")}
                      disabled={!mayDecide || isOwn}
                      title={isOwn ? "Requester can't self-approve" : undefined}
                    >
                      Approve
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty">
            <h4>Inbox zero</h4>
            <p>Nothing is waiting for a second approver.</p>
          </div>
        )}
      </div>

      <p className="tiny" style={{ marginTop: 10 }}>
        Dual approval applies to coin adjustments above 500, price or free-count changes above 20%,
        and takedowns. The requester can never approve their own request.
      </p>
    </>
  );
}

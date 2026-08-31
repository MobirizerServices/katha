import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { AdminUser } from "../api/types";
import { Modal, PageHeader, fmtN } from "../ui";
import { ME, useStore } from "../store";
import { DUAL_APPROVAL, ROLE_NAMES, canAct } from "../auth/roles";

const REASONS = [
  "Failed transaction verified (App Store)",
  "Failed transaction verified (gateway)",
  "Goodwill · playback issue",
  "Goodwill · support delay",
  "Fraud reversal",
  "Refund clawback correction",
];

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

function AdjustDialog({
  user,
  onClose,
}: {
  user: AdminUser;
  onClose: () => void;
}) {
  const { addApproval, addAudit, showToast, role } = useStore();
  const [dir, setDir] = useState<"Credit" | "Debit">("Credit");
  const [amount, setAmount] = useState(100);
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");

  const needsApproval = amount > DUAL_APPROVAL.coinAdjustment;

  function submit() {
    if (needsApproval) {
      // Above 500 coins: nothing is written to the ledger. A second approver
      // from Finance or Admin must confirm — the request goes to the inbox.
      addApproval({
        id: "apr_" + uid(),
        kind: "Coin adjustment",
        detail: `${dir} ${fmtN(amount)} coins · ${user.id} · ${reason}`,
        requestedBy: ME,
        when: "Just now",
        needs: "Finance or Admin",
        amount: dir === "Credit" ? amount : -amount,
        userId: user.id,
      });
      showToast("Approval requested · Finance notified · nothing written yet");
    } else {
      // At or below 500: writes a single idempotent ledger row directly.
      addAudit({
        actor: ME,
        action: "wallet.adjust",
        entity: user.id,
        change: `${dir} ${amount}${note ? " · " + note : ""} · ${reason}`,
      });
      showToast(
        `Ledger entry written · ${dir.toLowerCase()} ${amount} coins · idempotency key admin:${uid()}`
      );
    }
    onClose();
  }

  const allowed = canAct(role, "support,finance");

  return (
    <Modal
      title={`Adjust coins · ${user.id}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn s" onClick={onClose}>
            Cancel
          </button>
          <button className="btn p" onClick={submit} disabled={!allowed}>
            {needsApproval ? "Request approval" : "Write ledger entry"}
          </button>
        </>
      }
    >
      {!allowed ? (
        <div className="warnbox">
          {ROLE_NAMES[role]} cannot make money adjustments. Support or Finance only.
        </div>
      ) : null}
      <div className="row2">
        <label className="fld">
          Direction
          <select value={dir} onChange={(e) => setDir(e.target.value as "Credit" | "Debit")}>
            <option>Credit</option>
            <option>Debit</option>
          </select>
        </label>
        <label className="fld">
          Coins
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
          />
        </label>
      </div>
      <label className="fld">
        Reason code
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <label className="fld">
        Note for the audit log
        <textarea
          placeholder="What did you verify?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {needsApproval ? (
        <div className="warnbox">
          Above {DUAL_APPROVAL.coinAdjustment} coins: a second approver from Finance or Admin
          confirms before the ledger row is written. The request appears in the Approvals inbox.
        </div>
      ) : null}
    </Modal>
  );
}

export function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adjustFor, setAdjustFor] = useState<AdminUser | null>(null);
  const { role } = useStore();

  useEffect(() => {
    api.listUsers().then((u) => {
      setUsers(u);
      setSelectedId((cur) => cur ?? u[0]?.id ?? null);
    });
  }, []);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return users;
    return users.filter(
      (u) =>
        u.id.includes(query) ||
        u.phone.toLowerCase().includes(query) ||
        u.name.toLowerCase().includes(query) ||
        u.devices.join(" ").toLowerCase().includes(query)
    );
  }, [users, q]);

  const selected = users.find((u) => u.id === selectedId) ?? null;
  const maskPii = role === "finance"; // finance sees masked PII in the matrix

  return (
    <>
      <PageHeader
        title="Users & wallet"
        subtitle="Look up by phone, Apple id, device or user id. Money actions need a reason code; above 500 coins they need a second approver."
      />

      <div className="grid g21" style={{ marginTop: 0 }}>
        <div className="panel">
          <h3>
            Lookup
            <span className="sub">{results.length} results</span>
          </h3>
          <div className="pad" style={{ paddingBottom: 0 }}>
            <div className="search" style={{ maxWidth: "100%" }}>
              <span>⌕</span>
              <input
                style={{ border: 0, background: "none", flex: 1, color: "var(--text)", outline: "none" }}
                placeholder="Phone, user id, name or device…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
          <div className="tablewrap" style={{ maxHeight: 460 }}>
            <table className="t">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Languages</th>
                  <th className="num">Balance</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {results.map((u) => (
                  <tr
                    key={u.id}
                    className="link"
                    style={u.id === selectedId ? { background: "var(--accent-soft)" } : undefined}
                    onClick={() => setSelectedId(u.id)}
                  >
                    <td>
                      <div className="tt">{u.name !== "—" ? u.name : u.id}</div>
                      <div className="ss">
                        {maskPii ? "•••• masked" : u.phone} · {u.id}
                      </div>
                    </td>
                    <td>{u.languages}</td>
                    <td className="num">{fmtN(u.wallet.bought + u.wallet.bonus)}</td>
                    <td>
                      {u.flags.length
                        ? u.flags.map((f) => (
                            <span key={f} className="tag d" style={{ marginRight: 3 }}>
                              {f}
                            </span>
                          ))
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3>Wallet & account</h3>
          {selected ? (
            <div className="pad">
              <div className="wallet-coins">
                <div className="coinbox coin">
                  <div className="tiny">Bought coins</div>
                  <div className="n">{fmtN(selected.wallet.bought)}</div>
                </div>
                <div className="coinbox coin">
                  <div className="tiny">Bonus coins</div>
                  <div className="n">{fmtN(selected.wallet.bonus)}</div>
                </div>
                <div className="coinbox">
                  <div className="tiny">Episodes unlocked</div>
                  <div className="n">{fmtN(selected.wallet.unlocked)}</div>
                </div>
              </div>
              <p className="tiny" style={{ margin: "10px 0 16px" }}>
                Bonus coins are spent before bought coins. Coins never expire.
              </p>
              <dl className="kv">
                <dt>User id</dt>
                <dd className="mono">{selected.id}</dd>
                <dt>Phone</dt>
                <dd>{maskPii ? "•••• masked (finance)" : selected.phone}</dd>
                <dt>LTV</dt>
                <dd>{selected.wallet.ltv}</dd>
                <dt>Last active</dt>
                <dd>{selected.lastActive}</dd>
                <dt>Payer</dt>
                <dd>{selected.payer}</dd>
                <dt>Devices</dt>
                <dd>{selected.devices.join(", ")}</dd>
              </dl>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button className="btn p" onClick={() => setAdjustFor(selected)}>
                  Adjust coins…
                </button>
                <button className="btn s">View ledger</button>
              </div>
            </div>
          ) : (
            <div className="empty">
              <h4>Select a user</h4>
              <p>Pick a result to see their wallet.</p>
            </div>
          )}
        </div>
      </div>

      {adjustFor ? <AdjustDialog user={adjustFor} onClose={() => setAdjustFor(null)} /> : null}
    </>
  );
}

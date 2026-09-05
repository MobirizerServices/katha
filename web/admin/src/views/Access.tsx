import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { api, mutate } from "../api/client";
import type { AccessUser } from "../api/client";
import { Modal, PageHeader } from "../ui";
import { PERMISSION_MATRIX, ROLE_NAMES, ROLE_ORDER } from "../auth/roles";
import type { MatrixRow } from "../auth/roles";
import { useStore } from "../store";

function cellStyle(v: string): CSSProperties {
  if (v === "yes") return { color: "var(--ok)", fontWeight: 700 };
  if (v === "no") return { color: "var(--text3)" };
  return { color: "var(--warn)", fontWeight: 600 };
}
function cellText(v: string): string {
  if (v === "yes") return "✓";
  if (v === "no") return "–";
  return v;
}

/** Server matrix → the render shape; falls back to the static copy offline. */
function fromServer(matrix: { capability: string; roles: string[];
                              notes?: Record<string, string> }[]): MatrixRow[] {
  return matrix.map((row) => ({
    cap: row.capability,
    cells: ROLE_ORDER.map((r) =>
      row.notes?.[r] ? row.notes[r] : row.roles.includes(r) ? "yes" : "no"),
  }));
}

/** Who may sign in at all — the OIDC provisioning directory (#074). */
function People() {
  const { role, online, identity, showToast } = useStore();
  const [users, setUsers] = useState<AccessUser[] | null>(null);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState("support");
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  const reload = useCallback(() => {
    void api.listAccessUsers().then((r) => setUsers(r ? r.users : null));
  }, []);
  useEffect(reload, [reload]);

  const finish = useCallback(async (target: string, r: string, confirm?: string) => {
    const res = await mutate.grantAccess(target, r, confirm);
    if ("offline" in res) {
      showToast("Offline — nothing was written to the server", "error");
      return;
    }
    if (res.error) {
      showToast(`Not granted: ${res.error}`, "error");
      return;
    }
    showToast(`${target} can now sign in as ${ROLE_NAMES[r as never] ?? r}`);
    setEmail("");
    reload();
  }, [reload, showToast]);

  const grant = useCallback(() => {
    const target = email.trim().toLowerCase();
    if (newRole === "admin") {
      setTyped("");
      setConfirming(true);
      return;
    }
    void finish(target, newRole);
  }, [email, newRole, finish]);

  const revoke = useCallback(async (target: string) => {
    const res = await mutate.revokeAccess(target);
    if ("offline" in res) {
      showToast("Offline — nothing was written to the server", "error");
      return;
    }
    if (res.error) {
      showToast(`Not revoked: ${res.error}`, "error");
      return;
    }
    showToast(`${target} can no longer sign in`);
    reload();
  }, [reload, showToast]);

  if (role !== "admin") return null;
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <header>
        <h3>Provisioned operators</h3>
        <span className="muted tiny">
          {users === null ? "" : `${users.length} account${users.length === 1 ? "" : "s"}`}
        </span>
      </header>
      <p className="muted tiny" style={{ margin: 0, padding: "12px 16px 0" }}>
        Only these accounts can sign in. Roles are looked up on every request —
        revoking takes effect immediately, and every change lands in the audit log.
      </p>
      {users === null ? (
        <div className="muted tiny" style={{ padding: "12px 16px" }}>
          {online ? "Admins only — the server refused the list." : "Offline — the directory lives on the server."}
        </div>
      ) : (
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr><th>Email</th><th>Role</th><th>Granted by</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email}>
                  <td className="mono">{u.email}</td>
                  <td>{ROLE_NAMES[u.role as never] ?? u.role}</td>
                  <td className="tiny muted">{u.by ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn s" disabled={!online || u.email === identity?.email}
                            title={u.email === identity?.email ? "You can't revoke yourself" : ""}
                            onClick={() => void revoke(u.email)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="acct">
        <div className="frow" style={{ alignItems: "flex-end" }}>
          <label className="fld" style={{ flex: 2 }}>
            Email to provision
            <input aria-label="Email to provision" placeholder="name@katha.dev"
                   value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="fld">
            Role
            <select aria-label="Role to grant" value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}>
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>{ROLE_NAMES[r]}</option>
              ))}
            </select>
          </label>
          <button className="btn p" disabled={!online || !email.includes("@")}
                  onClick={grant}>
            Grant access
          </button>
        </div>
      </div>
      {confirming ? (
        <Modal title="Grant full admin?" onClose={() => setConfirming(false)}
               footer={
                 <>
                   <button className="btn s" onClick={() => setConfirming(false)}>Cancel</button>
                   <button className="btn danger" disabled={typed !== email.trim().toLowerCase()}
                           onClick={() => { setConfirming(false);
                                            void finish(email.trim().toLowerCase(), "admin",
                                                        email.trim().toLowerCase()); }}>
                     Grant admin
                   </button>
                 </>
               }>
          <p>
            Admin can move money, erase users and change access. Type the email
            to confirm:
          </p>
          <input aria-label="Confirm email" value={typed} autoFocus
                 onChange={(e) => setTyped(e.target.value)}
                 placeholder={email.trim().toLowerCase()} />
        </Modal>
      ) : null}
    </div>
  );
}

export function Access() {
  const [rows, setRows] = useState<MatrixRow[]>(PERMISSION_MATRIX);
  const [live, setLive] = useState(false);

  useEffect(() => {
    void api.matrix().then((m) => {
      if (m) {
        setRows(fromServer(m.matrix));
        setLive(true);
      }
    });
  }, []);

  return (
    <>
      <PageHeader
        title="Roles & access"
        subtitle={
          live
            ? "Served by admin-api from the same table the routes enforce — this page cannot drift from reality."
            : "Google Workspace SSO with enforced 2FA. Roles map from IdP groups. Sensitive actions re-authenticate; money actions above thresholds need two people."
        }
      />
      <div className="panel">
        <h3>Permission matrix</h3>
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr>
                <th>Capability</th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} style={{ textAlign: "center" }}>
                    {ROLE_NAMES[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.cap}>
                  <td>{row.cap}</td>
                  {row.cells.map((c, i) => (
                    <td key={i} style={{ textAlign: "center", ...cellStyle(c) }}>
                      {cellText(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <People />
    </>
  );
}

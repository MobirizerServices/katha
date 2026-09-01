import { NavLink } from "react-router-dom";
import { NAV } from "./nav";
import { ROLE_NAMES, ROLE_ORDER, canView, type Role } from "./auth/roles";
import { useStore } from "./store";

export function Sidebar() {
  const { role, setRole, approvals, identity, logout } = useStore();
  const oidc = identity?.mode === "oidc" && identity.authenticated;

  const counts: Record<string, { n: number; cls?: string }> = {
    approvals: { n: approvals.length, cls: "w" },
  };

  return (
    <aside className="side">
      <div className="brand">
        <span className="logo">▶</span>
        Katha Admin
        <span className="env">Production</span>
      </div>

      {NAV.map((g) => (
        <div key={g.title}>
          <div className="grp">{g.title}</div>
          {g.items.map((it) => {
            const allowed = canView(role, it.view);
            const cnt = counts[it.view];
            const inner = (
              <>
                <span className="ico">{it.icon}</span>
                {it.label}
                {cnt && cnt.n ? (
                  <span className={`cnt ${cnt.cls ?? ""}`}>{cnt.n}</span>
                ) : it.kb ? (
                  <span className="cnt" style={{ background: "transparent", color: "#6b6b75" }}>
                    {it.kb}
                  </span>
                ) : null}
              </>
            );
            if (!allowed) {
              return (
                <div key={it.view} className="navi lock" aria-disabled>
                  {inner}
                </div>
              );
            }
            return (
              <NavLink
                key={it.view}
                to={it.path}
                className={({ isActive }) => `navi${isActive ? " on" : ""}`}
              >
                {inner}
              </NavLink>
            );
          })}
        </div>
      ))}

      {oidc ? (
        // The real signed-in operator — role comes from the server directory.
        <div className="me">
          <div className="av">{(identity.email ?? "?")[0].toUpperCase()}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "#fff", fontWeight: 600, overflow: "hidden",
                          textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                 title={identity.email}>
              {identity.name || identity.email}
            </div>
            <div className="tiny">{ROLE_NAMES[role] ?? role}</div>
          </div>
          <button className="btn s" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      ) : (
        <div className="me">
          <div className="av">R</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 600 }}>Riya Menon</div>
            <div className="tiny">{ROLE_NAMES[role]} · dev auth</div>
          </div>
          <select
            aria-label="Preview as role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLE_ORDER.map((r) => (
              <option key={r} value={r}>
                Preview as {ROLE_NAMES[r]}
              </option>
            ))}
          </select>
        </div>
      )}
    </aside>
  );
}

import { Navigate, Route, Routes } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useStore } from "./store";
import { canView, ROLE_NAMES } from "./auth/roles";
import { ALL_NAV_ITEMS } from "./nav";
import { Overview } from "./views/Overview";
import { Catalog } from "./views/Catalog";
import { Users } from "./views/Users";
import { Approvals } from "./views/Approvals";
import { Config } from "./views/Config";
import { Audit } from "./views/Audit";
import { Access } from "./views/Access";
import type { ReactNode } from "react";

function Denied({ view }: { view: string }) {
  const { role } = useStore();
  return (
    <div className="denied">
      <h1 style={{ fontSize: 20 }}>
        {ROLE_NAMES[role]} can't open {view}
      </h1>
      <p className="muted">
        Access is granted by role through Google Workspace groups. Ask an Admin, or request access.
      </p>
      <div style={{ marginTop: 16 }}>
        <a className="btn s" href="#/overview">
          Back to overview
        </a>
      </div>
    </div>
  );
}

function Guard({ view, children }: { view: string; children: ReactNode }) {
  const { role } = useStore();
  if (!canView(role, view)) {
    const label = ALL_NAV_ITEMS.find((n) => n.view === view)?.label ?? view;
    return <Denied view={label} />;
  }
  return <>{children}</>;
}

function Topbar() {
  return (
    <div className="topbar">
      <div className="search">
        <span>⌕</span>
        <span style={{ flex: 1 }}>Search series, users, tickets, or type a command…</span>
        <span className="kbd">⌘K</span>
      </div>
      <span className="sp" />
      <span className="pill">
        <span className="dot" />
        All systems normal
      </span>
    </div>
  );
}

function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return (
    <div className="toasts">
      <div className="toast">{toast}</div>
    </div>
  );
}

export default function App() {
  return (
    <div className="app">
      <Sidebar />
      <main>
        <Topbar />
        <div className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<Guard view="overview"><Overview /></Guard>} />
            <Route path="/catalog" element={<Guard view="catalog"><Catalog /></Guard>} />
            <Route path="/users" element={<Guard view="users"><Users /></Guard>} />
            <Route path="/approvals" element={<Guard view="approvals"><Approvals /></Guard>} />
            <Route path="/config" element={<Guard view="config"><Config /></Guard>} />
            <Route path="/audit" element={<Guard view="audit"><Audit /></Guard>} />
            <Route path="/access" element={<Guard view="access"><Access /></Guard>} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </div>
      </main>
      <Toast />
    </div>
  );
}

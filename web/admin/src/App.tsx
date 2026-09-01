import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useStore } from "./store";
import { canView, ROLE_NAMES } from "./auth/roles";
import { ALL_NAV_ITEMS } from "./nav";
import { api, mutate } from "./api/client";
import { Skeleton } from "./ui";
import { Login } from "./views/Login";
import { t } from "./i18n";

const Overview = lazy(() => import("./views/Overview").then((m) => ({ default: m.Overview })));
const Catalog = lazy(() => import("./views/Catalog").then((m) => ({ default: m.Catalog })));
const CatalogDetail = lazy(() => import("./views/CatalogDetail").then((m) => ({ default: m.CatalogDetail })));
const Users = lazy(() => import("./views/Users").then((m) => ({ default: m.Users })));
const Approvals = lazy(() => import("./views/Approvals").then((m) => ({ default: m.Approvals })));
const Config = lazy(() => import("./views/Config").then((m) => ({ default: m.Config })));
const Audit = lazy(() => import("./views/Audit").then((m) => ({ default: m.Audit })));
const Grievances = lazy(() => import("./views/Grievances").then((m) => ({ default: m.Grievances })));
const Access = lazy(() => import("./views/Access").then((m) => ({ default: m.Access })));

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

/** One render error must not white-screen the whole panel (#105). */
export class ViewBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("view crashed", err, info.componentStack);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="denied">
          <h1 style={{ fontSize: 20 }}>This view hit an error</h1>
          <p className="muted mono">{String(this.state.err)}</p>
          <div style={{ marginTop: 16 }}>
            <button className="btn s" onClick={() => this.setState({ err: null })}>
              Reload view
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---- ⌘K command palette (#086) ---------------------------------------------
interface Cmd {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

function Palette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [dynamic, setDynamic] = useState<Cmd[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const navCmds: Cmd[] = useMemo(
    () =>
      ALL_NAV_ITEMS.map((n) => ({
        id: `nav-${n.view}`,
        label: `Go to ${n.label}`,
        hint: n.kb,
        run: () => nav(n.path),
      })),
    [nav]
  );

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setDynamic([]);
      return;
    }
    let dead = false;
    const t = window.setTimeout(async () => {
      const [users, series] = await Promise.all([
        api.listUsers({ q: needle, limit: 5 }),
        api.listSeries(),
      ]);
      if (dead) return;
      const cmds: Cmd[] = [];
      for (const u of users.users.slice(0, 5)) {
        cmds.push({ id: `u-${u.id}`, label: `User · ${u.id}`,
                    hint: `${u.wallet.bought + u.wallet.bonus} coins`,
                    run: () => nav(`/users?sel=${u.id}`) });
      }
      for (const s of series.filter((x) =>
          x.title.toLowerCase().includes(needle.toLowerCase()) ||
          x.slug.includes(needle.toLowerCase())).slice(0, 5)) {
        cmds.push({ id: `s-${s.slug}`, label: `Series · ${s.title}`,
                    hint: s.slug, run: () => nav(`/catalog/${s.slug}`) });
      }
      setDynamic(cmds);
    }, 250);
    return () => {
      dead = true;
      window.clearTimeout(t);
    };
  }, [q, nav]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const stat = needle
      ? navCmds.filter((c) => c.label.toLowerCase().includes(needle))
      : navCmds;
    return [...stat, ...dynamic].slice(0, 10);
  }, [q, navCmds, dynamic]);

  useEffect(() => setSel(0), [shown.length, q]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          value={q}
          placeholder="Jump to a user, series or view…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, shown.length - 1));
            if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
            if (e.key === "Enter" && shown[sel]) {
              shown[sel].run();
              onClose();
            }
          }}
        />
        <div className="plist" role="listbox">
          {shown.map((c, i) => (
            <button
              key={c.id}
              role="option"
              aria-selected={i === sel}
              className={i === sel ? "pitem on" : "pitem"}
              onMouseMove={() => setSel(i)}
              onClick={() => {
                c.run();
                onClose();
              }}
            >
              <span>{c.label}</span>
              {c.hint ? <span className="muted mono">{c.hint}</span> : null}
            </button>
          ))}
          {shown.length === 0 ? <div className="pitem muted">No matches</div> : null}
        </div>
      </div>
    </>
  );
}

function Topbar({ openPalette }: { openPalette: () => void }) {
  const { health, online } = useStore();
  const status = !online ? "offline" : (health?.status ?? "…");
  const cls = status === "ok" ? "ok" : status === "…" ? "" : "bad";
  const label =
    status === "ok" ? t("All systems normal")
    : status === "offline" ? t("Server unreachable")
    : status === "degraded" ? t("Degraded") : status === "down" ? t("Service down") : t("Checking…");
  const detail = health
    ? Object.entries(health.checks).map(([k, v]) => `${k}: ${v}`).join(" · ")
    : "";
  return (
    <div className="topbar">
      <button type="button" className="search" onClick={openPalette}
              aria-label="Open command palette">
        <span>⌕</span>
        <span style={{ flex: 1, textAlign: "left" }}>
          Search users, series, or jump to a view…
        </span>
        <span className="kbd">⌘K</span>
      </button>
      <span className="sp" />
      <span className={`pill ${cls}`} title={detail}>
        <span className="dot" />
        {label}
      </span>
    </div>
  );
}

function Toasts() {
  const { toasts } = useStore();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={t.kind === "error" ? "toast err" : "toast"}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function OfflineBanner() {
  const { online } = useStore();
  if (online) return null;
  return (
    <div className="offline" role="status">
      Offline — showing sample data. Changes are disabled until the server answers.
    </div>
  );
}

export default function App() {
  const [palette, setPalette] = useState(false);
  const nav = useNavigate();
  const location = useLocation();
  const { signedOut } = useStore();

  // ⌘K + g-shortcuts (#086/#087)
  useEffect(() => {
    let pendingG = false;
    let gTimer = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (typing) return;
      if (pendingG) {
        const hit = ALL_NAV_ITEMS.find((n) => n.kb === `g ${e.key.toLowerCase()}`);
        if (hit) {
          e.preventDefault();
          nav(hit.path);
        }
        pendingG = false;
        window.clearTimeout(gTimer);
        return;
      }
      if (e.key.toLowerCase() === "g") {
        pendingG = true;
        gTimer = window.setTimeout(() => {
          pendingG = false;
        }, 800);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [nav]);

  // Which views operators actually use (#112) — steers the roadmap.
  useEffect(() => {
    void mutate.uiPing(location.pathname.split("/")[1] || "overview");
  }, [location.pathname]);

  // OIDC mode with no session: the whole panel is behind sign-in (#074).
  if (signedOut) {
    return (
      <>
        <Login />
        <Toasts />
      </>
    );
  }

  return (
    <div className="app">
      <Sidebar />
      <main>
        <Topbar openPalette={() => setPalette(true)} />
        <OfflineBanner />
        <div className="content">
          <ViewBoundary key={location.pathname}>
            <Suspense fallback={<Skeleton rows={6} />}>
              <Routes>
                <Route path="/" element={<Navigate to="/overview" replace />} />
                <Route path="/overview" element={<Guard view="overview"><Overview /></Guard>} />
                <Route path="/catalog" element={<Guard view="catalog"><Catalog /></Guard>} />
                <Route path="/catalog/:slug" element={<Guard view="catalog"><CatalogDetail /></Guard>} />
                <Route path="/users" element={<Guard view="users"><Users /></Guard>} />
                <Route path="/approvals" element={<Guard view="approvals"><Approvals /></Guard>} />
                <Route path="/grievances" element={<Guard view="grievances"><Grievances /></Guard>} />
                <Route path="/config" element={<Guard view="config"><Config /></Guard>} />
                <Route path="/audit" element={<Guard view="audit"><Audit /></Guard>} />
                <Route path="/access" element={<Guard view="access"><Access /></Guard>} />
                <Route path="*" element={<Navigate to="/overview" replace />} />
              </Routes>
            </Suspense>
          </ViewBoundary>
        </div>
      </main>
      {palette ? <Palette onClose={() => setPalette(false)} /> : null}
      <Toasts />
    </div>
  );
}

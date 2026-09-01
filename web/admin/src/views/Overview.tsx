import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Overview as OverviewData } from "../api/types";
import { ME, useStore } from "../store";
import { PageHeader, Sev, Skeleton } from "../ui";

// KPI → where its detail lives (#008: every number is a door).
const KPI_LINKS: Record<string, string> = {
  "Registered users": "/users",
  "Coins purchased (all time)": "/audit",
  "Coins outstanding": "/users?sort=balance",
  "Episodes unlocked": "/users?segment=payers",
  "Gross revenue equivalent": "/audit",
  "Live series": "/catalog",
};

export function Overview() {
  const { attention, refreshSignals, identity } = useStore();
  const [data, setData] = useState<OverviewData | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number>(0);
  const [tick, setTick] = useState(0);
  const timer = useRef<number>(0);

  const load = useCallback(async () => {
    setData(await api.getOverview());
    setFetchedAt(Date.now());
    refreshSignals();
  }, [refreshSignals]);

  useEffect(() => {
    void load();
    timer.current = window.setInterval(() => void load(), 60_000);   // #002: real polling
    const t2 = window.setInterval(() => setTick((x) => x + 1), 5_000);
    return () => {
      window.clearInterval(timer.current);
      window.clearInterval(t2);
    };
  }, [load]);

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const who = identity?.authenticated
    ? (identity.name || identity.email || ME).split(" ")[0].toLowerCase()
    : ME;
  const agoS = fetchedAt ? Math.max(0, Math.round((Date.now() - fetchedAt) / 1000)) : null;
  void tick;

  if (!data) {
    return (
      <>
        <PageHeader title={`${greeting}, ${who}`} subtitle="Loading dashboard…" />
        <Skeleton rows={4} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`${greeting}, ${who}`}
        subtitle={`${today} · refreshes every minute${agoS === null ? "" : ` · updated ${agoS}s ago`}`}
      />

      <div className="kpis">
        {data.kpis.map((k) => {
          const to = KPI_LINKS[k.label];
          const card = (
            <div className={to ? "kpi kpi-link" : "kpi"} key={k.label}>
              <div className="lbl">{k.label}</div>
              <div className="val">{k.value}</div>
              {k.delta ? (
                <div className={k.deltaDir === "down" ? "delta down" : "delta"}>{k.delta}</div>
              ) : null}
            </div>
          );
          return to ? (
            <Link to={to} key={k.label} style={{ textDecoration: "none", color: "inherit" }}>
              {card}
            </Link>
          ) : (
            card
          );
        })}
      </div>

      <div className="cols">
        <section className="panel">
          <header>
            <h3>Needs attention</h3>
            <span className="muted">
              {attention.length === 0 ? "all clear" : `${attention.length} item(s) · click to act`}
            </span>
          </header>
          {attention.length === 0 ? (
            <p className="muted" style={{ padding: "18px 16px" }}>
              Nothing needs a human right now — pending approvals, grievance SLA breaches
              and unhealthy services would appear here.
            </p>
          ) : (
            <ul className="attn">
              {attention.map((a) => (
                <li key={a.id}>
                  <Link to={a.to} className="attnrow">
                    <Sev level={a.severity}>{a.severity === "danger" ? "SLA" : "ACT"}</Sev>
                    <span>
                      <b>{a.title}</b>
                      <small className="muted"> {a.detail}</small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {data.pipeline.length > 0 ? (
          <section className="panel">
            <header>
              <h3>Publishing pipeline</h3>
              <span className="muted">episodes by stage</span>
            </header>
            <ul className="pipe">
              {data.pipeline.map((p) => (
                <li key={p.label}>
                  <span>{p.label}</span>
                  <b>{p.count}</b>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}

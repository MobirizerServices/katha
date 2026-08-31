import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Overview as OverviewData } from "../api/types";
import { PageHeader } from "../ui";
import { useStore } from "../store";

const SEV_COLOR: Record<string, string> = {
  danger: "var(--danger)",
  warn: "var(--warn)",
  info: "var(--info)",
};

export function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const { approvals } = useStore();
  const nav = useNavigate();

  useEffect(() => {
    api.getOverview().then(setData);
  }, []);

  if (!data) {
    return (
      <>
        <PageHeader title="Good morning, Riya" subtitle="Loading dashboard…" />
        <div className="kpis">
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="kpi" key={i}>
              <div className="l">—</div>
              <div className="v">…</div>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Good morning, Riya"
        subtitle="Monday 31 August 2026 · live counters refresh every minute."
      />

      <div className="kpis">
        {data.kpis.map((k) => (
          <div className="kpi" key={k.label}>
            <div className="l">{k.label}</div>
            <div className="v">{k.value}</div>
            {k.delta ? (
              <div className="dl">
                {k.deltaDir ? (
                  <span className={k.deltaDir}>{k.delta}</span>
                ) : (
                  k.delta
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid g21">
        <div className="panel">
          <h3>
            Needs attention
            <span className="sub">{data.attention.length} items · sorted by impact · click to act</span>
          </h3>
          <div className="alerts">
            {data.attention.map((a) => {
              const detail =
                a.id === "a6"
                  ? approvals.map((x) => x.kind).join(" · ") || "Inbox zero"
                  : a.detail;
              return (
                <div className="alert link" key={a.id} onClick={() => nav(a.to)}>
                  <span className="dot" style={{ background: SEV_COLOR[a.severity] }} />
                  <div>
                    <b>{a.title}</b>
                    <span className="muted">{detail}</span>
                  </div>
                  <span className="when">{a.when}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <h3>
            Publishing pipeline
            <span className="sub">episodes by stage</span>
          </h3>
          <div className="pad" style={{ display: "grid", gap: 10, fontSize: 13 }}>
            {data.pipeline.map((s) => (
              <div key={s.label}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{s.label}</span>
                  <b>{s.count}</b>
                </div>
                <div className={`bar ${s.tone}`}>
                  <i style={{ width: `${s.pct}%` }} />
                </div>
              </div>
            ))}
            <p className="tiny" style={{ margin: "6px 0 0" }}>
              Median master → live: 31 h · target ≤ 48 h.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

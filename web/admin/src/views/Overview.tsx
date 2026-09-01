import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, mutate } from "../api/client";
import type { Analytics, AnalyticsWindow } from "../api/client";
import type { Overview as OverviewData } from "../api/types";
import { ME, useStore } from "../store";
import { PageHeader, Sev, Skeleton, Spark, fmtN } from "../ui";

type Win = "today" | "7d" | "30d";

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return cur ? <span className="delta">new</span> : null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return <span className="delta muted">±0%</span>;
  return (
    <span className={pct < 0 ? "delta down" : "delta"}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

/** One business metric with its period delta + 30-day sparkline. */
function Metric({ label, value, cur, prev, spark }:
                { label: string; value: string; cur: number; prev: number;
                  spark?: number[] }) {
  return (
    <div className="kpi">
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      <Delta cur={cur} prev={prev} />
      {spark ? <div style={{ marginTop: 6 }}><Spark points={spark} /></div> : null}
    </div>
  );
}

function Funnel({ f }: { f: { paywall_view: number; purchase: number; unlock: number } }) {
  const stages = [
    { label: "Saw the paywall", n: f.paywall_view },
    { label: "Bought coins", n: f.purchase },
    { label: "Unlocked an episode", n: f.unlock },
  ];
  const max = Math.max(f.paywall_view, 1);
  return (
    <div className="funnel">
      {stages.map((s, i) => {
        const prev = i === 0 ? s.n : stages[i - 1].n;
        const drop = i > 0 && prev > 0
          ? ` · ${Math.round(((prev - s.n) / prev) * 100)}% drop`
          : "";
        return (
          <div key={s.label} className="fstage">
            <div className="fbar" style={{ width: `${(s.n / max) * 100}%` }} />
            <span>{s.label}</span>
            <b className="mono">{fmtN(s.n)}{drop}</b>
          </div>
        );
      })}
    </div>
  );
}

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

  const [an, setAn] = useState<Analytics | null>(null);
  const [win, setWin] = useState<Win>("7d");

  const load = useCallback(async () => {
    setData(await api.getOverview());
    setAn(await api.analytics());
    setFetchedAt(Date.now());
    refreshSignals();
  }, [refreshSignals]);

  async function ack(id: string) {
    const res = await mutate.ackAttention(id);
    if ("offline" in res || res.error) return;
    refreshSignals();
  }

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

      {an ? (
        <section className="panel" style={{ marginTop: 4, marginBottom: 16 }}>
          <header>
            <h3>The business</h3>
            <span className="wins" role="tablist" aria-label="Time window">
              {(["today", "7d", "30d"] as Win[]).map((w) => (
                <button key={w} role="tab" aria-selected={win === w}
                        className={win === w ? "fbtn on" : "fbtn"}
                        onClick={() => setWin(w)}>
                  {w === "today" ? "Today" : w}
                </button>
              ))}
            </span>
          </header>
          {(() => {
            const cur: AnalyticsWindow = an.windows[win].current;
            const prev: AnalyticsWindow = an.windows[win].previous;
            const iapPct = cur.coins_purchased
              ? Math.round((cur.coins_iap * 100) / cur.coins_purchased) : 0;
            return (
              <>
                <div className="kpis" style={{ padding: "12px 14px 0" }}>
                  <Metric label="Revenue equivalent" value={`₹${fmtN(cur.revenue_rupees)}`}
                          cur={cur.revenue_rupees} prev={prev.revenue_rupees}
                          spark={an.spark.coins_purchased} />
                  <Metric label="Coins purchased" value={fmtN(cur.coins_purchased)}
                          cur={cur.coins_purchased} prev={prev.coins_purchased} />
                  <Metric label="Episodes unlocked" value={fmtN(cur.unlocks)}
                          cur={cur.unlocks} prev={prev.unlocks}
                          spark={an.spark.unlocks} />
                  <Metric label="Peak DAU" value={fmtN(cur.dau_peak)}
                          cur={cur.dau_peak} prev={prev.dau_peak}
                          spark={an.spark.dau} />
                  <Metric label="New users" value={fmtN(cur.new_users)}
                          cur={cur.new_users} prev={prev.new_users}
                          spark={an.spark.new_users} />
                  <Metric label="Watch minutes" value={fmtN(cur.watch_minutes)}
                          cur={cur.watch_minutes} prev={prev.watch_minutes}
                          spark={an.spark.watch_minutes} />
                </div>
                <div className="anrow">
                  <div>
                    <h4>Where the money comes from</h4>
                    <div className="splitbar" aria-label="Revenue split">
                      <span style={{ width: `${iapPct}%` }} />
                    </div>
                    <p className="tiny muted">
                      App Store {iapPct}% · Web (UPI) {100 - iapPct}% —{" "}
                      {fmtN(cur.coins_web)} coins sold on the web this period.
                    </p>
                    <h4 style={{ marginTop: 12 }}>Refunds</h4>
                    <p className="tiny">
                      <Sev level={cur.refund_ratio_pct > 2 ? "danger" : "ok"}>
                        {cur.refund_ratio_pct}%
                      </Sev>{" "}
                      of purchased coins refunded (App Store health threshold: 2%).
                    </p>
                  </div>
                  <div>
                    <h4>Paywall → purchase → unlock ({win === "today" ? "1d" : win})</h4>
                    <Funnel f={an.funnel[win === "today" ? "1d" : win]} />
                  </div>
                  <div>
                    <h4>Coin liability</h4>
                    <div className="val" style={{ fontSize: 22 }}>
                      {fmtN(an.outstanding_trend[an.outstanding_trend.length - 1] ?? 0)} coins
                    </div>
                    <p className="tiny muted">
                      ≈ ₹{fmtN(an.outstanding_rupees)} of unserved obligation ·{" "}
                      {fmtN(an.breakage_dormant_coins)} coins dormant 90+ days (breakage)
                    </p>
                    <Spark points={an.outstanding_trend} width={180} height={36} />
                  </div>
                </div>
              </>
            );
          })()}
        </section>
      ) : null}

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
                  <div className="attnrow" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Link to={a.to} style={{ display: "flex", gap: 10, flex: 1,
                                             color: "inherit", textDecoration: "none" }}>
                      <Sev level={a.severity}>{a.severity === "danger" ? "SLA" : "ACT"}</Sev>
                      <span>
                        <b>{a.title}</b>
                        <small className="muted"> {a.detail}</small>
                      </span>
                    </Link>
                    {a.ack ? (
                      <small className="muted" title={a.ack.at}>✓ {a.ack.by}</small>
                    ) : (
                      <button className="btn s" onClick={() => void ack(a.id)}>
                        Ack
                      </button>
                    )}
                  </div>
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

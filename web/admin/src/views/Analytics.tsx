import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Analytics as AnalyticsData, AnalyticsWindow } from "../api/client";
import { Chip, Empty, Funnel, Metric, PageHeader, Sev, Skeleton, Spark, fmtN } from "../ui";

type Win = "today" | "7d" | "30d";

/** The full business board (#009-#015): windowed KPIs with deltas, revenue
 *  split, funnel, refunds, liability, and the day-by-day table. Overview
 *  shows a compact cut of the same numbers. */
export function Analytics() {
  const [an, setAn] = useState<AnalyticsData | null | undefined>(undefined);
  const [win, setWin] = useState<Win>("7d");

  useEffect(() => { void api.analytics().then(setAn); }, []);

  if (an === undefined) return <Skeleton rows={6} />;
  if (an === null) {
    return (
      <>
        <PageHeader title="Analytics" subtitle="Canonical metrics from the ledger and event stream." />
        <Empty title="Analytics unavailable"
               hint="The rollup needs the persisted ledger (KATHA_PERSIST=1) and a reachable admin-api." />
      </>
    );
  }

  const cur: AnalyticsWindow = an.windows[win].current;
  const prev: AnalyticsWindow = an.windows[win].previous;
  const iapPct = cur.coins_purchased
    ? Math.round((cur.coins_iap * 100) / cur.coins_purchased) : 0;
  const fkey = win === "today" ? "1d" : win;

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle={`Canonical metrics from the ledger and event stream · generated ${an.generated_at}`}
        actions={
          <span className="wins" role="tablist" aria-label="Time window">
            {(["today", "7d", "30d"] as Win[]).map((w) => (
              <Chip key={w} on={win === w} onClick={() => setWin(w)}>
                {w === "today" ? "Today" : w}
              </Chip>
            ))}
          </span>
        }
      />

      <div className="kpis">
        <Metric label="Revenue equivalent" value={`₹${fmtN(cur.revenue_rupees)}`}
                cur={cur.revenue_rupees} prev={prev.revenue_rupees}
                spark={an.spark.coins_purchased} />
        <Metric label="Coins purchased" value={fmtN(cur.coins_purchased)}
                cur={cur.coins_purchased} prev={prev.coins_purchased} />
        <Metric label="Episodes unlocked" value={fmtN(cur.unlocks)}
                cur={cur.unlocks} prev={prev.unlocks} spark={an.spark.unlocks} />
        <Metric label="Peak DAU" value={fmtN(cur.dau_peak)}
                cur={cur.dau_peak} prev={prev.dau_peak} spark={an.spark.dau} />
        <Metric label="New users" value={fmtN(cur.new_users)}
                cur={cur.new_users} prev={prev.new_users} spark={an.spark.new_users} />
        <Metric label="Watch minutes" value={fmtN(cur.watch_minutes)}
                cur={cur.watch_minutes} prev={prev.watch_minutes}
                spark={an.spark.watch_minutes} />
      </div>

      <section className="panel">
        <header><h3>The business</h3><span className="muted">{win === "today" ? "today" : `last ${win}`}</span></header>
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
              of purchased coins refunded ({fmtN(cur.coins_refunded)} coins; App Store
              health threshold: 2%).
            </p>
          </div>
          <div>
            <h4>Paywall → purchase → unlock ({fkey})</h4>
            <Funnel f={an.funnel[fkey]} />
          </div>
          <div>
            <h4>Coin liability</h4>
            <div className="val" style={{ fontSize: 22 }}>
              {fmtN(an.outstanding_trend[an.outstanding_trend.length - 1] ?? 0)} coins
            </div>
            <p className="tiny muted">
              ≈ ₹{fmtN(an.outstanding_rupees)} of unserved obligation at ₹{an.coin_rupee_rate}/coin ·{" "}
              {fmtN(an.breakage_dormant_coins)} coins dormant 90+ days (breakage)
            </p>
            <Spark points={an.outstanding_trend} width={180} height={36} />
          </div>
        </div>
      </section>

      <div className="panel" style={{ marginTop: 16 }}>
        <header><h3>Day by day</h3><span className="muted">last {an.days.length} days</span></header>
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr><th>Day</th>
                  <th style={{ textAlign: "right" }}>Coins bought</th>
                  <th style={{ textAlign: "right" }}>Unlocks</th>
                  <th style={{ textAlign: "right" }}>DAU</th>
                  <th style={{ textAlign: "right" }}>New users</th>
                  <th style={{ textAlign: "right" }}>Watch min</th>
                  <th style={{ textAlign: "right" }}>Paywall views</th></tr>
            </thead>
            <tbody>
              {an.days.map((d, i) => (
                <tr key={d}>
                  <td className="mono">{d}</td>
                  {["coins_purchased", "unlocks", "dau", "new_users", "watch_minutes",
                    "paywall_views"].map((k) => (
                    <td key={k} style={{ textAlign: "right" }} className="mono">
                      {fmtN(an.spark[k][i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

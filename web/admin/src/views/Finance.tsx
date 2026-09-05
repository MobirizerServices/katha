import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BASE_URL, api } from "../api/client";
import type { Analytics, Policy } from "../api/client";
import { useStore } from "../store";
import { IsoTime, Metric, PageHeader, Sev, Skeleton, fmtN } from "../ui";

type InvoiceRow = {
  id: string; user_id: string; sku: string; coins: number; bonus_coins: number;
  total_minor: number; taxable_minor: number; gst_minor: number;
  gst_rate_pct: number; created_at: string;
};
type Invoices = { rows: InvoiceRow[];
                  totals: { count: number; gross_minor: number; gst_minor: number } };

/** Paise-accurate rupees with en-IN grouping — ₹1,999.00, not ₹1999.00, so a
 *  register total reads the same way as the KPI beside it (ADM-25). */
export function paise(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toLocaleString("en-IN");
  return `${sign}₹${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** The GST register: every web/UPI sale with its tax split — what finance
 * files from. Apple invoices IAP itself. */
export function InvoiceRegister({ data }: { data: Invoices }) {
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <header>
        <h3>Tax invoices (web/UPI)</h3>
        <span className="muted">
          {fmtN(data.totals.count)} invoices · gross {paise(data.totals.gross_minor)} ·
          GST {paise(data.totals.gst_minor)}{" "}
          <a className="btn s" href={`${BASE_URL}/invoices.csv`} download>
            Export CSV
          </a>
        </span>
      </header>
      {data.rows.length === 0 ? (
        <p className="muted tiny" style={{ padding: "12px 14px" }}>
          Web coin sales are invoiced automatically — the register fills with the
          first UPI purchase.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Invoice</th><th>Buyer</th><th>Pack</th>
                <th style={{ textAlign: "right" }}>Taxable</th>
                <th style={{ textAlign: "right" }}>GST</th>
                <th style={{ textAlign: "right" }}>Total</th><th>Date</th></tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.id}</td>
                <td className="mono">{r.user_id}</td>
                <td>{fmtN(r.coins)}{r.bonus_coins ? ` +${fmtN(r.bonus_coins)}` : ""} coins</td>
                <td style={{ textAlign: "right" }} className="mono">{paise(r.taxable_minor)}</td>
                <td style={{ textAlign: "right" }} className="mono">{paise(r.gst_minor)}</td>
                <td style={{ textAlign: "right" }} className="mono">{paise(r.total_minor)}</td>
                <td><IsoTime iso={r.created_at} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Finance board: revenue and refunds derived from the ledger (never from
 *  events), the coin liability, what waits for a second person, the GST
 *  register, and the money policy in force. Composed from existing reads. */
export function Finance() {
  const { approvals } = useStore();
  const [inv, setInv] = useState<Invoices | null>(null);
  const [an, setAn] = useState<Analytics | null | undefined>(undefined);
  const [policy, setPolicy] = useState<Policy | null>(null);

  useEffect(() => {
    void api.invoices().then(setInv);
    void api.analytics().then(setAn);
    void api.policy().then(setPolicy);
  }, []);

  if (inv === null || an === undefined || policy === null) return <Skeleton rows={6} />;

  const w = an ? an.windows["30d"] : null;
  const gstRate = inv.rows.length ? `${inv.rows[0].gst_rate_pct}%` : "—";

  return (
    <>
      <PageHeader
        title="Finance"
        subtitle="Revenue is derived from the ledger, never from events. Every external report is reconciled against it; the GST register is what gets filed."
        actions={<Link className="btn s" to="/approvals">Approvals inbox ({approvals.length})</Link>}
      />

      {w && an ? (
        <div className="kpis">
          {/* short labels: "Revenue equivalent · 30d" wrapped and made the first
              card taller than its neighbours (ADM-33) */}
          <Metric label="Revenue · 30d" value={`₹${fmtN(w.current.revenue_rupees)}`}
                  cur={w.current.revenue_rupees} prev={w.previous.revenue_rupees} />
          <Metric label="Coins bought · 30d" value={fmtN(w.current.coins_purchased)}
                  cur={w.current.coins_purchased} prev={w.previous.coins_purchased} />
          <Metric label="Coins refunded · 30d" value={fmtN(w.current.coins_refunded)}
                  cur={w.current.coins_refunded} prev={w.previous.coins_refunded} />
          <div className="kpi">
            <div className="lbl">Refund ratio · 30d</div>
            <div className="val">
              <Sev level={w.current.refund_ratio_pct > 2 ? "danger" : "ok"}>
                {w.current.refund_ratio_pct}%
              </Sev>
            </div>
            <div className="tiny muted">App Store health threshold: 2%</div>
          </div>
          <div className="kpi">
            <div className="lbl">Coin liability</div>
            <div className="val">≈ ₹{fmtN(an.outstanding_rupees)}</div>
            <div className="tiny muted">{fmtN(an.breakage_dormant_coins)} coins dormant 90+ days</div>
          </div>
          <Link to="/approvals" className="kpi kpi-link" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="lbl">Pending approvals</div>
            <div className="val">{approvals.length}</div>
            <div className="tiny muted">adjustments above {fmtN(policy.dual_approval_threshold)} coins</div>
          </Link>
        </div>
      ) : (
        <p className="muted tiny">
          Revenue and refund figures need the persisted ledger — the analytics
          endpoint answered nothing usable.
        </p>
      )}

      <div className="panel">
        <header><h3>Money policy in force</h3><span className="muted">from config</span></header>
        <div className="acct">
          <dl className="kv">
            <dt>Coin → rupee rate</dt><dd className="mono">₹{policy.coin_rupee_rate} per coin</dd>
            <dt>Dual approval above</dt><dd className="mono">{fmtN(policy.dual_approval_threshold)} coins</dd>
            <dt>GST rate on web sales</dt>
            <dd className="mono">{gstRate}
              <small className="muted"> — from the register; seller GSTIN travels in the CSV export</small></dd>
            <dt>Default pricing</dt>
            <dd>first {policy.pricing.free_episode_count} free · {policy.pricing.episode_coin_price} coins · bundle −{policy.pricing.bundle_discount_pct}%</dd>
          </dl>
        </div>
      </div>

      <InvoiceRegister data={inv} />
    </>
  );
}

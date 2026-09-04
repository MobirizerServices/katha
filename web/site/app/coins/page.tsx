"use client";
import { useEffect, useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import { useWallet } from "@/components/WalletProvider";
import { api, type PackDTO, type ConfigDTO } from "@/lib/api";
import { PACK_PRESENTATION, fmt } from "@/lib/catalog";

/**
 * The coin store renders what the server sells: pack sizes, prices and the
 * web bonus all come from /v1/iap/packs; the per-episode estimate uses the
 * pricing facts from /v1/config. No number on this page is made up here.
 */
export default function CoinsPage() {
  const w = useWallet();
  const [packs, setPacks] = useState<PackDTO[] | null>(null);
  const [cfg, setCfg] = useState<ConfigDTO | null>(null);
  const [paying, setPaying] = useState<PackDTO | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.packs().then((p) => !cancelled && setPacks(p)).catch(() => !cancelled && setPacks([]));
    api.config().then((c) => !cancelled && setCfg(c)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const rupees = (minor: number) => fmt(Math.round(minor / 100));
  const perEpisode = (p: PackDTO): string | null => {
    if (!cfg || cfg.episode_coin_price <= 0) return null;
    const episodes = (p.coins + p.web_bonus_coins) / cfg.episode_coin_price;
    return (p.price_minor / 100 / episodes).toFixed(1);
  };
  const episodeRupees = cfg ? (cfg.episode_coin_price * cfg.coin_rupee_rate).toFixed(1) : null;

  return (
    <>
      <div className="storehead">
        <h1>Get coins</h1>
        <p>
          {episodeRupees ? `Unlock episodes for about ₹${episodeRupees} each. ` : "Unlock episodes with coins. "}
          Coins never expire while your account exists, and web purchases add a{" "}
          <b style={{ color: "var(--coin)" }}>web bonus</b>.
        </p>
      </div>

      <div className="walletbar">
        <span className="coin lg" />
        <div>
          <b>{w.ready ? fmt(w.balance) : "0"}</b> coins
          <div className="muted">
            {fmt(w.bought)} bought · {fmt(w.bonus)} bonus — bonus is spent first
          </div>
        </div>
      </div>

      <div className="packs" aria-busy={packs === null}>
        {packs === null && <p className="muted">Loading packs…</p>}
        {packs !== null && packs.length === 0 && (
          <p className="muted" role="alert">The store is unavailable right now. Try again in a moment.</p>
        )}
        {packs?.map((p) => {
          const pres = PACK_PRESENTATION[p.sku] || { name: p.sku };
          const total = p.coins + p.web_bonus_coins;
          const per = perEpisode(p);
          return (
            <button
              key={p.sku}
              className={`pack ${pres.highlight ? "hi" : ""}`}
              onClick={() => {
                if (!w.signed) {
                  w.openSignIn("/coins");
                  w.toast("Sign in first — takes 10 seconds");
                  return;
                }
                setPaying(p);
              }}
            >
              {pres.tag && <span className={`tagt ${pres.gold ? "gold" : ""}`}>{pres.tag}</span>}
              <span className="coinsrow">
                <span className="coin" />
                {fmt(total)}
              </span>
              <span className="bonus">
                {fmt(p.coins)} + {fmt(p.web_bonus_coins)} = {fmt(total)} coins
              </span>
              <span className="math">includes the web bonus</span>
              <span className="price">₹{rupees(p.price_minor)}</span>
              {per && <span className="per">≈ ₹{per} per episode</span>}
            </button>
          );
        })}
      </div>

      <p className="storenote">
        Prices include GST; a tax invoice is emailed for every web purchase. Coins bought on the web are
        usable everywhere you sign in. Unused, unspent coins from web purchases are refundable within 7 days.
        Payments are processed by Razorpay; Katha never sees your UPI PIN.
      </p>

      <SiteFooter />

      {paying && (
        <PayModal
          pack={paying}
          onClose={() => setPaying(null)}
          onPay={async (email) => {
            // The wallet only changes when the server says the order is
            // captured; the toast carries the coins it actually credited.
            await w.purchase(paying.sku, email);
            setPaying(null);
          }}
        />
      )}
    </>
  );
}

function PayModal({
  pack,
  onClose,
  onPay,
}: {
  pack: PackDTO;
  onClose: () => void;
  onPay: (email: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const total = pack.coins + pack.web_bonus_coins;
  const pay = async () => {
    setBusy(true);
    await onPay(email.trim());
  };
  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label="Pay by UPI">
        <div className="mh">
          <h2>Pay ₹{fmt(Math.round(pack.price_minor / 100))} by UPI</h2>
          <button className="x" onClick={onClose} aria-label="Close" disabled={busy}>
            &times;
          </button>
        </div>
        <div className="mb">
          <p className="d">
            You&rsquo;ll get <b style={{ color: "var(--text)" }}>{fmt(pack.coins)} coins</b> +{" "}
            <b style={{ color: "var(--coin)" }}>{fmt(pack.web_bonus_coins)} web bonus</b> = {fmt(total)} coins.
            GST invoice by email.
          </p>
          {!busy && (
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email for the GST invoice (optional)"
              aria-label="Invoice email"
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 12,
                       background: "var(--bg)", color: "var(--text)",
                       border: "1px solid var(--line)", borderRadius: 8,
                       padding: "10px 12px" }}
            />
          )}
          {busy ? (
            <p className="d" style={{ textAlign: "center", padding: "12px 0" }}>
              Confirming your payment…
            </p>
          ) : (
            <>
              <div style={{ display: "grid", gap: 8 }}>
                <button className="btn s" onClick={pay}>
                  PhonePe
                </button>
                <button className="btn s" onClick={pay}>
                  Google Pay
                </button>
                <button className="btn s" onClick={pay}>
                  Paytm
                </button>
                <div style={{ fontSize: 12, color: "var(--text3)", textAlign: "center" }}>
                  or pay to <b style={{ color: "var(--text2)" }}>katha@icici</b>
                </div>
                <button className="btn p" onClick={pay}>
                  I&rsquo;ve paid — verify
                </button>
              </div>
              <p style={{ color: "var(--text3)", fontSize: 12, margin: "14px 0 0", textAlign: "center" }}>
                Processed by Razorpay · unspent coins refundable within 7 days.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

"use client";
import { useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import { useWallet } from "@/components/WalletProvider";
import {
  COIN_PACKS,
  CoinPack,
  webBonusCoins,
  webTotalCoins,
  coinsToRupees,
  EPISODE_COIN_PRICE,
  fmt,
} from "@/lib/catalog";

export default function CoinsPage() {
  const w = useWallet();
  const [paying, setPaying] = useState<CoinPack | null>(null);

  // Starter doubles on the very first pack; web bonus applies to the base.
  const baseCoins = (p: CoinPack) => (p.sku === "coins_starter_in" && w.firstPack ? p.coins * 2 : p.coins);

  return (
    <>
      <div className="storehead">
        <h1>Get coins</h1>
        <p>
          Unlock episodes for about ₹{coinsToRupees(EPISODE_COIN_PRICE)} each. Coins never expire while your
          account exists, and web purchases add a <b style={{ color: "var(--coin)" }}>+10% web bonus</b>.
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

      <div className="packs">
        {COIN_PACKS.map((p) => {
          const base = baseCoins(p);
          const bonus = webBonusCoins(base);
          const total = base + bonus;
          const perEp = (p.priceInr / (total / EPISODE_COIN_PRICE)).toFixed(1);
          return (
            <button
              key={p.sku}
              className={`pack ${p.highlight ? "hi" : ""}`}
              onClick={() => {
                if (!w.signed) {
                  w.openSignIn("/coins");
                  w.toast("Sign in first — takes 10 seconds");
                  return;
                }
                setPaying(p);
              }}
            >
              {p.tag && (
                <span className={`tagt ${p.gold ? "gold" : ""}`}>
                  {p.sku === "coins_starter_in" && w.firstPack ? "2× ON FIRST PACK" : p.tag}
                </span>
              )}
              <span className="coinsrow">
                <span className="coin" />
                {fmt(total)}
              </span>
              <span className="bonus">
                {fmt(base)} + {fmt(bonus)} = {fmt(total)} coins
              </span>
              <span className="math">includes +10% web bonus</span>
              <span className="price">₹{fmt(p.priceInr)}</span>
              <span className="per">≈ ₹{perEp} per episode</span>
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
          base={baseCoins(paying)}
          onClose={() => setPaying(null)}
          onPaid={() => {
            w.purchase(baseCoins(paying), paying.priceInr, paying.sku);
            setPaying(null);
          }}
        />
      )}
    </>
  );
}

function PayModal({
  pack,
  base,
  onClose,
  onPaid,
}: {
  pack: CoinPack;
  base: number;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const bonus = webBonusCoins(base);
  const pay = () => {
    setBusy(true);
    setTimeout(onPaid, 1200); // simulate UPI confirmation
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label="Pay by UPI">
        <div className="mh">
          <h2>Pay ₹{fmt(pack.priceInr)} by UPI</h2>
          <button className="x" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="mb">
          <p className="d">
            You&rsquo;ll get <b style={{ color: "var(--text)" }}>{fmt(base)} coins</b> +{" "}
            <b style={{ color: "var(--coin)" }}>{fmt(bonus)} web bonus</b> = {fmt(webTotalCoins(base))} coins.
            GST invoice by email.
          </p>
          {busy ? (
            <p className="d" style={{ textAlign: "center", padding: "12px 0" }}>
              Waiting for UPI confirmation… Approve the request in your UPI app.
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

"use client";
import Link from "next/link";
import { useWallet } from "./WalletProvider";
import { fmt } from "@/lib/catalog";

export default function SiteHeader() {
  const w = useWallet();
  return (
    <header className="site">
      <div className="wrap nav">
        <Link className="brand" href="/">
          <span className="appmark">▶</span>
          Katha<small>कथा</small>
        </Link>
        <nav className="links" aria-label="Primary">
          <Link href="/#series">Series</Link>
          <Link href="/#how">How coins work</Link>
          <Link href="/#faq">Help</Link>
          <Link href="/coins">Coins</Link>
        </nav>
        <div className="right">
          <Link className="coinpill" href="/coins" aria-label="Coin balance">
            <span className="coin" />
            {w.ready ? fmt(w.balance) : "0"}
          </Link>
          {w.signed ? (
            <span className="avatar" aria-label="Profile">
              {w.name.charAt(0) || "M"}
            </span>
          ) : (
            <button className="signin" onClick={() => w.openSignIn()}>
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

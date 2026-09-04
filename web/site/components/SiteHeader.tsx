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
          <Link href="/browse">Browse</Link>
          <Link href="/search">Search</Link>
          {w.signed && <Link href="/mylist">My list</Link>}
          <Link href="/#how">How coins work</Link>
          <Link href="/#business">For studios &amp; brands</Link>
          <Link href="/coins">Coins</Link>
        </nav>
        <div className="right">
          <Link className="coinpill" href="/coins" aria-label="Coin balance">
            <span className="coin" />
            {w.ready ? fmt(w.balance) : "0"}
          </Link>
          {w.signed ? (
            <Link className="avatar" href="/profile" aria-label="Profile">
              {w.name.charAt(0) || "M"}
            </Link>
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

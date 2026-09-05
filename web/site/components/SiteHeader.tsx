"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "./WalletProvider";
import { fmt } from "@/lib/catalog";

/** The primary destinations, in the order the header lists them. `member`
 * links only exist once there is an account to hang them on. */
const LINKS: { href: string; label: string; member?: boolean }[] = [
  { href: "/browse", label: "Browse" },
  { href: "/search", label: "Search" },
  { href: "/mylist", label: "My list", member: true },
  { href: "/#how", label: "How coins work" },
  { href: "/#business", label: "For studios & brands" },
  { href: "/coins", label: "Coins" },
];

/**
 * Below 1000px the link row cannot fit without wrapping onto two lines, so it
 * collapses into a menu rather than disappearing: a watch page has no footer,
 * and hiding the row there left the viewer with only a back chevron.
 */
export default function SiteHeader() {
  const w = useWallet();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const links = LINKS.filter((l) => !l.member || w.signed);

  // A route change closes the sheet (Next keeps the header mounted across
  // navigations, so nothing else would).
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="site">
      <div className="wrap nav">
        <Link className="brand" href="/">
          <span className="appmark">▶</span>
          Katha<small>कथा</small>
        </Link>
        <nav className="links" aria-label="Primary">
          {links.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="right">
          <button
            className="navtoggle"
            aria-label="Menu"
            aria-expanded={open}
            aria-controls="navmenu"
            onClick={() => setOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none"
                 stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
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
      {open && (
        <div className="navmenu" id="navmenu">
          <nav aria-label="Primary (menu)">
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </Link>
            ))}
            {w.signed && (
              <Link href="/profile" onClick={() => setOpen(false)}>
                Profile
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

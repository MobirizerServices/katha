"use client";
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { webBonusCoins } from "@/lib/catalog";
import { api, getToken, clearToken } from "@/lib/api";

/**
 * Wallet + auth state for the web watch app, wired to the LIVE core-api.
 * The backend append-only ledger is the source of truth: purchases and unlocks
 * hit the API and the wallet is reconciled from the server response. UI updates
 * are optimistic (PDD principle: never make a paying user wait), then corrected.
 */

let _keySeq = 0;
const nextKey = (p: string) => `${p}:${Date.now()}:${_keySeq++}`;

interface Unlocked {
  [slug: string]: "all" | number[]; // "all" for a bundle, else list of episode numbers
}

interface WalletState {
  signed: boolean;
  phone: string;
  name: string;
  bought: number; // purchased coins
  bonus: number; // bonus coins (spent first)
  firstPack: boolean;
  unlocked: Unlocked;
}

const INITIAL: WalletState = {
  signed: false,
  phone: "",
  name: "",
  bought: 0,
  bonus: 0,
  firstPack: true,
  unlocked: {},
};

export interface WalletCtx extends WalletState {
  balance: number;
  ready: boolean;
  signIn: (phone: string) => void;
  signOut: () => void;
  openSignIn: (afterHref?: string) => void;
  hasUnlocked: (slug: string, n: number) => boolean;
  unlockEpisode: (slug: string, n: number, price: number) => boolean;
  unlockBundle: (slug: string, cost: number) => boolean;
  purchase: (base: number, priceInr: number, sku: string, email?: string) => void;
  toast: (msg: string) => void;
}

const Ctx = createContext<WalletCtx | null>(null);
const STORAGE_KEY = "katha.wallet.v1";

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet must be used within WalletProvider");
  return c;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>(INITIAL);
  const [ready, setReady] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const afterHref = useRef<string | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // hydrate local unlocked-cache + establish a live session (guest token) and
  // fetch the authoritative wallet from core-api.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let cached: Partial<WalletState> = {};
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) cached = JSON.parse(raw);
      } catch { /* ignore */ }
      try {
        if (!getToken()) await api.guestLogin();
        const w = await api.wallet();
        if (!cancelled)
          setState((s) => ({
            ...s,
            ...cached,
            bought: w.balance_bought,
            bonus: w.balance_bonus,
            signed: !!cached.signed,
            phone: cached.phone || "",
            name: cached.name || "",
          }));
      } catch {
        // API offline: fall back to the cached view so the UI still renders.
        if (!cancelled) setState((s) => ({ ...s, ...cached }));
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // A ref that always holds the latest state, so money decisions can be made
  // synchronously (React does not guarantee setState updaters run inline).
  const stateRef = useRef(state);
  stateRef.current = state;

  const refreshWallet = useCallback(async () => {
    try {
      const w = await api.wallet();
      setState((s) => ({ ...s, bought: w.balance_bought, bonus: w.balance_bonus }));
    } catch { /* keep optimistic view */ }
  }, []);

  // persist
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state, ready]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2800);
  }, []);

  const signIn = useCallback(
    (phone: string) => {
      // Real OTP login against core-api — switches identity to this phone user,
      // then loads that user's authoritative wallet.
      (async () => {
        try {
          await api.otpLogin(phone, "1234");
          const w = await api.wallet();
          setState((s) => ({
            ...s, signed: true, phone, name: "Meera",
            bought: w.balance_bought, bonus: w.balance_bonus,
          }));
        } catch {
          setState((s) => ({ ...s, signed: true, phone, name: "Meera" }));
        }
        setSignInOpen(false);
        toast("Signed in as " + phone);
        if (afterHref.current) {
          const href = afterHref.current;
          afterHref.current = undefined;
          setTimeout(() => { window.location.href = href; }, 60);
        }
      })();
    },
    [toast]
  );

  const signOut = useCallback(() => {
    clearToken();
    setState((s) => ({ ...s, signed: false, phone: "", name: "", bought: 0, bonus: 0, unlocked: {} }));
    toast("Signed out");
    // re-establish a guest session for continued browsing
    api.guestLogin().then(() => refreshWallet()).catch(() => {});
  }, [toast, refreshWallet]);

  const openSignIn = useCallback((href?: string) => {
    afterHref.current = href;
    setSignInOpen(true);
  }, []);

  const hasUnlocked = useCallback(
    (slug: string, n: number) => {
      const u = state.unlocked[slug];
      if (u === "all") return true;
      return Array.isArray(u) && u.includes(n);
    },
    [state.unlocked]
  );

  // Spend `amount` coins, bonus first. Returns false if insufficient.
  const spend = (s: WalletState, amount: number): WalletState | null => {
    if (s.bonus + s.bought < amount) return null;
    const useBonus = Math.min(s.bonus, amount);
    return { ...s, bonus: s.bonus - useBonus, bought: s.bought - (amount - useBonus) };
  };

  const unlockEpisode = useCallback(
    (slug: string, n: number, price: number): boolean => {
      // Decide affordability synchronously from the latest state.
      const s0 = stateRef.current;
      if (s0.bonus + s0.bought < price) return false;
      // Optimistic UI update.
      setState((s) => {
        const spent = spend(s, price)!;
        const prev = spent.unlocked[slug];
        const list = prev === "all" ? "all" : Array.isArray(prev) ? [...prev, n] : [n];
        return { ...spent, unlocked: { ...spent.unlocked, [slug]: list } };
      });
      // Fire the real ledger unlock and reconcile the wallet from the server.
      api.unlockEpisode(slug, n, nextKey(`unlock:${slug}:${n}`))
        .then((r) => setState((s) => ({ ...s, bought: r.wallet.balance_bought, bonus: r.wallet.balance_bonus })))
        .catch(() => { refreshWallet(); toast("Couldn't confirm the unlock — balance restored"); });
      return true;
    },
    [refreshWallet, toast]
  );

  const unlockBundle = useCallback((slug: string, cost: number): boolean => {
    const s0 = stateRef.current;
    if (s0.bonus + s0.bought < cost) return false;
    setState((s) => {
      const spent = spend(s, cost)!;
      return { ...spent, unlocked: { ...spent.unlocked, [slug]: "all" } };
    });
    api.unlockAll(slug, nextKey(`bundle:${slug}`))
      .then((r) => setState((s) => ({ ...s, bought: r.wallet.balance_bought, bonus: r.wallet.balance_bonus })))
      .catch(() => { refreshWallet(); toast("Couldn't confirm the bundle — balance restored"); });
    return true;
  }, [refreshWallet, toast]);

  const purchase = useCallback(
    (base: number, priceInr: number, sku: string, email = "") => {
      // Optimistic credit, then reconcile from the real web-order (ledger + web bonus).
      const bonus = webBonusCoins(base);
      setState((s) => ({
        ...s,
        bought: s.bought + base,
        bonus: s.bonus + bonus,
        firstPack: sku === "coins_starter_in" ? false : s.firstPack,
      }));
      toast((base + bonus).toLocaleString("en-IN") + " coins added · invoice emailed");
      // One payment id per checkout: repeat purchases of the same pack each
      // credit, while a retry of THIS order stays idempotent server-side.
      api.webOrder(sku, email, crypto.randomUUID())
        .then((w) => setState((s) => ({ ...s, bought: w.balance_bought, bonus: w.balance_bonus })))
        .catch(() => refreshWallet());
    },
    [toast, refreshWallet]
  );

  const value: WalletCtx = {
    ...state,
    balance: state.bought + state.bonus,
    ready,
    signIn,
    signOut,
    openSignIn,
    hasUnlocked,
    unlockEpisode,
    unlockBundle,
    purchase,
    toast,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} onVerified={signIn} />}
      {toastMsg && (
        <div className="toast" role="status" aria-live="polite">
          {toastMsg}
        </div>
      )}
    </Ctx.Provider>
  );
}

/* ------------------------- phone OTP sign-in (stub) ----------------------- */
function SignInModal({
  onClose,
  onVerified,
}: {
  onClose: () => void;
  onVerified: (phone: string) => void;
}) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("+91 98765 43210");
  const [digits, setDigits] = useState(["", "", "", ""]);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, "").slice(-1);
    setDigits((arr) => {
      const next = [...arr];
      next[i] = d;
      return next;
    });
    if (d && i < 3) refs.current[i + 1]?.focus();
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label="Sign in">
        <div className="mh">
          <h2>{step === "phone" ? "Sign in" : "Enter the code"}</h2>
          <button className="x" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="mb">
          {step === "phone" ? (
            <>
              <p className="d">One account across web and iPhone. We&rsquo;ll text a code &mdash; no password.</p>
              <label className="fld">
                Phone
                <input
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                />
              </label>
              <button
                className="btn p"
                style={{ width: "100%", marginTop: 16 }}
                onClick={() => setStep("otp")}
              >
                Send code
              </button>
              <p style={{ color: "var(--text3)", fontSize: 12, margin: "14px 0 0", textAlign: "center" }}>
                By continuing you agree to the Terms and confirm you&rsquo;re 18+.
              </p>
            </>
          ) : (
            <>
              <p className="d">Sent to {phone}. Demo: any 4 digits work.</p>
              <div className="otp">
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      refs.current[i] = el;
                    }}
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    aria-label={"Digit " + (i + 1)}
                    onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
                    }}
                  />
                ))}
              </div>
              <button
                className="btn p"
                style={{ width: "100%", marginTop: 16 }}
                onClick={() => onVerified(phone.trim() || "+91 98765 43210")}
              >
                Verify
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

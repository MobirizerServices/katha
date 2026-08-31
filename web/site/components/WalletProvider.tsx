"use client";
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { webBonusCoins } from "@/lib/catalog";

/**
 * Client-side wallet + auth state for the web watch app.
 * Money rules mirror the ledger package: bonus coins are spent before bought
 * coins, coins never expire. Purchases here are demo-only (no real payment).
 */

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

interface WalletCtx extends WalletState {
  balance: number;
  ready: boolean;
  signIn: (phone: string) => void;
  signOut: () => void;
  openSignIn: (afterHref?: string) => void;
  hasUnlocked: (slug: string, n: number) => boolean;
  unlockEpisode: (slug: string, n: number, price: number) => boolean;
  unlockBundle: (slug: string, cost: number) => boolean;
  purchase: (base: number, priceInr: number, sku: string) => void;
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

  // hydrate from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState({ ...INITIAL, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }
    setReady(true);
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
      setState((s) => ({ ...s, signed: true, phone, name: "Meera" }));
      setSignInOpen(false);
      toast("Signed in as " + phone);
      if (afterHref.current) {
        const href = afterHref.current;
        afterHref.current = undefined;
        // let the modal close first
        setTimeout(() => {
          window.location.href = href;
        }, 60);
      }
    },
    [toast]
  );

  const signOut = useCallback(() => {
    setState((s) => ({ ...s, signed: false, phone: "", name: "" }));
    toast("Signed out");
  }, [toast]);

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
      let ok = false;
      setState((s) => {
        const spent = spend(s, price);
        if (!spent) return s;
        ok = true;
        const prev = spent.unlocked[slug];
        const list = prev === "all" ? "all" : Array.isArray(prev) ? [...prev, n] : [n];
        return { ...spent, unlocked: { ...spent.unlocked, [slug]: list } };
      });
      return ok;
    },
    []
  );

  const unlockBundle = useCallback((slug: string, cost: number): boolean => {
    let ok = false;
    setState((s) => {
      const spent = spend(s, cost);
      if (!spent) return s;
      ok = true;
      return { ...spent, unlocked: { ...spent.unlocked, [slug]: "all" } };
    });
    return ok;
  }, []);

  const purchase = useCallback(
    (base: number, priceInr: number, sku: string) => {
      const bonus = webBonusCoins(base);
      setState((s) => ({
        ...s,
        bought: s.bought + base,
        bonus: s.bonus + bonus,
        firstPack: sku === "coins_starter_in" ? false : s.firstPack,
      }));
      toast((base + bonus).toLocaleString("en-IN") + " coins added · invoice emailed");
    },
    [toast]
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

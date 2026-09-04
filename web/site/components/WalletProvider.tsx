"use client";
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { fmt } from "@/lib/catalog";
import { api, getToken, clearToken } from "@/lib/api";

/**
 * Wallet + auth state for the web watch app, wired to the LIVE core-api.
 *
 * The backend append-only ledger is the source of truth. This provider never
 * decides what an episode costs, whether it is unlocked, or how many coins a
 * purchase grants: every money action awaits the server and reconciles the
 * wallet from its answer. Access to an episode is asked of the playback
 * endpoint by the Player, not remembered here.
 */

let _keySeq = 0;
const nextKey = (p: string) => `${p}:${Date.now()}:${_keySeq++}`;

/** A payment id for one checkout. `crypto.randomUUID` is absent on insecure
 * origins (LAN-IP device testing), so fall back rather than throw mid-purchase. */
function paymentRef(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* fall through */ }
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface WalletState {
  signed: boolean;   // derived from the server profile (kind !== guest)
  phone: string;
  name: string;
  bought: number;    // purchased coins (server projection)
  bonus: number;     // bonus coins, spent first (server projection)
}

const INITIAL: WalletState = { signed: false, phone: "", name: "", bought: 0, bonus: 0 };

export type UnlockOutcome =
  | { ok: true; spent: number }
  | { ok: false; reason: "insufficient" | "error" };

export interface WalletCtx extends WalletState {
  balance: number;
  ready: boolean;
  /** Verify the typed OTP; resolves false (and toasts) when the server rejects it. */
  signIn: (phone: string, code: string) => Promise<boolean>;
  signOut: () => void;
  openSignIn: (afterHref?: string) => void;
  /** Ask the ledger to unlock; the wallet is reconciled from the answer. */
  unlockEpisode: (slug: string, n: number) => Promise<UnlockOutcome>;
  unlockBundle: (slug: string) => Promise<UnlockOutcome>;
  /** Buy a pack; resolves the coins the server credited, or null on failure. */
  purchase: (sku: string, email?: string) => Promise<number | null>;
  refreshWallet: () => Promise<void>;
  toast: (msg: string) => void;
}

const Ctx = createContext<WalletCtx | null>(null);
const STORAGE_KEY = "katha.wallet.v2";

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet must be used within WalletProvider");
  return c;
}

function fromProfile(p: { kind: string; phone: string | null; display_name: string }) {
  return { signed: p.kind !== "guest", phone: p.phone || "", name: p.display_name || "" };
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>(INITIAL);
  const [ready, setReady] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const afterHref = useRef<string | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Establish a live session (guest token) and load the authoritative wallet
  // and profile. The cached copy only paints the first frame / offline view.
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
        const [w, me] = await Promise.all([api.wallet(), api.me()]);
        if (!cancelled)
          setState({ bought: w.balance_bought, bonus: w.balance_bonus, ...fromProfile(me) });
      } catch {
        // API offline: paint the cached view so the UI still renders; nothing
        // money-related can happen until the server answers anyway.
        if (!cancelled) setState((s) => ({ ...s, ...cached }));
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Always the latest state, for money maths done outside React's render.
  const stateRef = useRef(state);
  stateRef.current = state;

  const refreshWallet = useCallback(async () => {
    try {
      const w = await api.wallet();
      setState((s) => ({ ...s, bought: w.balance_bought, bonus: w.balance_bonus }));
    } catch { /* keep the last server view */ }
  }, []);

  // persist the display cache
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
    async (phone: string, code: string): Promise<boolean> => {
      try {
        await api.otpLogin(phone, code);
      } catch {
        toast("That code didn't work — check it and try again");
        return false;
      }
      // Signed in: identity and wallet come from the server, never assumed.
      try {
        const [w, me] = await Promise.all([api.wallet(), api.me()]);
        setState({ bought: w.balance_bought, bonus: w.balance_bonus, ...fromProfile(me) });
      } catch {
        setState((s) => ({ ...s, signed: true, phone }));
      }
      setSignInOpen(false);
      toast("Signed in as " + phone);
      if (afterHref.current) {
        const href = afterHref.current;
        afterHref.current = undefined;
        setTimeout(() => { window.location.href = href; }, 60);
      }
      return true;
    },
    [toast]
  );

  const signOut = useCallback(() => {
    clearToken();
    setState(INITIAL);
    toast("Signed out");
    // re-establish a guest session for continued browsing
    api.guestLogin().then(() => refreshWallet()).catch(() => {});
  }, [toast, refreshWallet]);

  const openSignIn = useCallback((href?: string) => {
    afterHref.current = href;
    setSignInOpen(true);
  }, []);

  const applyWallet = (w: { balance_bought: number; balance_bonus: number }) =>
    setState((s) => ({ ...s, bought: w.balance_bought, bonus: w.balance_bonus }));

  const failure = async (e: unknown): Promise<UnlockOutcome> => {
    await refreshWallet();
    const status = (e as { status?: number } | null)?.status;
    return { ok: false, reason: status === 402 ? "insufficient" : "error" };
  };

  const unlockEpisode = useCallback(
    async (slug: string, n: number): Promise<UnlockOutcome> => {
      try {
        const r = await api.unlockEpisode(slug, n, nextKey(`unlock:${slug}:${n}`));
        applyWallet(r.wallet);
        return { ok: true, spent: r.spent_bonus + r.spent_bought };
      } catch (e) {
        return failure(e);
      }
    },
    [refreshWallet]
  );

  const unlockBundle = useCallback(
    async (slug: string): Promise<UnlockOutcome> => {
      try {
        const r = await api.unlockAll(slug, nextKey(`bundle:${slug}`));
        applyWallet(r.wallet);
        return { ok: true, spent: r.spent_bonus + r.spent_bought };
      } catch (e) {
        return failure(e);
      }
    },
    [refreshWallet]
  );

  const purchase = useCallback(
    async (sku: string, email = ""): Promise<number | null> => {
      const before = stateRef.current.bought + stateRef.current.bonus;
      try {
        // One payment id per checkout: repeat purchases of the same pack each
        // credit, while a retry of THIS order stays idempotent server-side.
        const w = await api.webOrder(sku, email, paymentRef());
        applyWallet(w);
        const credited = Math.max(0, w.total - before);
        toast(`${fmt(credited)} coins added · invoice emailed`);
        return credited;
      } catch {
        await refreshWallet();
        toast("Payment couldn't be confirmed — nothing was charged");
        return null;
      }
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
    unlockEpisode,
    unlockBundle,
    purchase,
    refreshWallet,
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

/* ---------------------------- phone OTP sign-in --------------------------- */
function SignInModal({
  onClose,
  onVerified,
}: {
  onClose: () => void;
  onVerified: (phone: string, code: string) => Promise<boolean>;
}) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("+91 98765 43210");
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const number = () => phone.trim() || "+91 98765 43210";

  const sendCode = async () => {
    setError(null);
    try {
      await api.otpRequest(number());
    } catch {
      // Delivery problems surface at verify; keep the flow moving.
    }
    setStep("otp");
  };

  const verify = async () => {
    const code = digits.join("");
    if (code.length !== 4) {
      setError("Enter all 4 digits");
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await onVerified(number(), code);
    setBusy(false);
    if (!ok) setError("That code didn't match. Try again.");
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
                onClick={sendCode}
              >
                Send code
              </button>
              <p style={{ color: "var(--text3)", fontSize: 12, margin: "14px 0 0", textAlign: "center" }}>
                By continuing you agree to the Terms and confirm you&rsquo;re 18+.
              </p>
            </>
          ) : (
            <>
              <p className="d">Enter the 4-digit code we texted to {phone}.</p>
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
              {error && (
                <p role="alert" style={{ color: "var(--danger, #e5484d)", fontSize: 13, margin: "10px 0 0" }}>
                  {error}
                </p>
              )}
              <button
                className="btn p"
                style={{ width: "100%", marginTop: 16 }}
                disabled={busy}
                onClick={verify}
              >
                {busy ? "Checking…" : "Verify"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

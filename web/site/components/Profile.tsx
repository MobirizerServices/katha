"use client";
import { useEffect, useState } from "react";
import { useWallet } from "./WalletProvider";
import { describeVerify } from "./PinGate";
import { api, type ProfileDTO } from "@/lib/api";
import { LANGUAGES, fmt, maskPhone } from "@/lib/catalog";
import { clearPin, isPinSet, isValidPin, setPin, verifyPin } from "@/lib/parentalLock";

/**
 * Who the viewer is, from /v1/me — the server profile, not the cached wallet
 * view. Every account action here (sign out everywhere, delete) is a server
 * call whose answer drives the UI; the parental lock is the one purely local
 * thing on the page, and it says so.
 */
export default function Profile() {
  const w = useWallet();
  const [me, setMe] = useState<ProfileDTO | null>(null);
  const [busy, setBusy] = useState<"devices" | "delete" | "lang" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!w.ready || !w.signed) return;
    let cancelled = false;
    api
      .me()
      .then((p) => !cancelled && setMe(p))
      .catch(() => !cancelled && w.toast("Couldn't load your profile — showing the last known view"));
    return () => {
      cancelled = true;
    };
  }, [w.ready, w.signed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!w.ready) return <p className="wrap muted" aria-busy="true" style={{ paddingTop: 30 }}>Loading…</p>;

  if (!w.signed) {
    return (
      <div className="empty" style={{ paddingTop: 110 }}>
        <h3>You&rsquo;re browsing as a guest</h3>
        <p>Sign in with your phone to buy coins, sync progress with the iPhone app, and keep your list.</p>
        <button className="btn p" style={{ display: "inline-flex" }} onClick={() => w.openSignIn("/profile")}>
          Sign in with phone
        </button>
        <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--text3)" }}>Free episodes play without an account.</p>
      </div>
    );
  }

  const name = me?.display_name || w.name || "Member";
  const phone = me?.phone ?? w.phone;
  const language = me?.language ?? "";

  const signOutOthers = async () => {
    setBusy("devices");
    try {
      await api.signOutDevices();
      w.toast("Signed out everywhere else — this browser stays signed in");
    } catch {
      w.toast("Couldn't reach the server — nothing was changed");
    }
    setBusy(null);
  };

  const setLanguage = async (code: string) => {
    setBusy("lang");
    try {
      setMe(await api.updateMe({ language: code }));
      w.toast("Content language saved");
    } catch {
      w.toast("Couldn't save the language — try again");
    }
    setBusy(null);
  };

  const deleteAccount = async () => {
    setBusy("delete");
    try {
      await api.deleteMe();
      setConfirmDelete(false);
      w.signOut();
      w.toast("Your account has been deleted");
    } catch {
      w.toast("Couldn't delete the account — try again");
    }
    setBusy(null);
  };

  return (
    <>
      <div className="phead wrap">
        <span className="avatar" aria-hidden="true">{name.charAt(0)}</span>
        <div>
          <h1>{name}</h1>
          <p>{phone ? maskPhone(phone) : "Phone not on file"}</p>
        </div>
      </div>

      <div className="pgrid wrap">
        <section className="panel" aria-label="Wallet">
          <h3>Wallet</h3>
          <div className="setrow">
            <div className="d">
              <b style={{ fontSize: 22 }}>{fmt(w.balance)}</b> coins
              <span>{fmt(w.bought)} bought · {fmt(w.bonus)} bonus — bonus is spent first</span>
            </div>
            <a className="btn gold sm" href="/coins">Get coins</a>
          </div>
        </section>

        <section className="panel" aria-label="Content language">
          <h3>Content language</h3>
          <div className="chips" style={{ padding: 0 }} role="group" aria-label="Content language">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                className={`chip ${language === l.code ? "on" : ""}`}
                aria-pressed={language === l.code}
                disabled={busy === "lang"}
                onClick={() => setLanguage(l.code)}
              >
                {l.native} · {l.name}
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12.5, margin: "12px 0 0" }}>
            Orders your home rows on the web and in the app. English subtitles are available on most series.
          </p>
        </section>

        <ParentalLockSettings />

        <section className="panel" aria-label="Account">
          <h3>Account</h3>
          <div className="setrow">
            <div className="d">Phone<span>{phone ? maskPhone(phone) : "—"}</span></div>
          </div>
          <div className="setrow">
            <div className="d">
              Other devices<span>Signs out every other browser and phone; this one stays in.</span>
            </div>
            <button className="btn s sm" disabled={busy !== null} onClick={signOutOthers}>
              {busy === "devices" ? "Signing out…" : "Sign out other devices"}
            </button>
          </div>
          <div className="setrow">
            <div className="d">Sign out</div>
            <button className="btn s sm" onClick={() => w.signOut()}>
              Sign out
            </button>
          </div>
          <div className="setrow">
            <div className="d">
              Delete account<span>Removes your profile and list. Coins are not refunded by deletion.</span>
            </div>
            {!confirmDelete && (
              <button className="btn s sm" onClick={() => setConfirmDelete(true)}>
                Delete account
              </button>
            )}
          </div>
          {confirmDelete && (
            <div className="confirm" role="alertdialog" aria-label="Confirm account deletion">
              <p>
                This deletes your profile, list and reminders now. Your purchase history is kept as a
                pseudonymous financial record, as the law requires. This cannot be undone.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn p sm" disabled={busy !== null} onClick={deleteAccount}>
                  {busy === "delete" ? "Deleting…" : "Yes, delete my account"}
                </button>
                <button className="btn s sm" disabled={busy !== null} onClick={() => setConfirmDelete(false)}>
                  Keep my account
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

type LockMode = "idle" | "set" | "change" | "remove";

/**
 * Parental lock: a 4-digit PIN kept as a salted hash in THIS browser (see
 * lib/parentalLock.ts). Change and remove require the current PIN, and five
 * misses lock the pad — the same rules as the iPhone app.
 */
export function ParentalLockSettings() {
  const [isSet, setIsSet] = useState(false);
  const [mode, setMode] = useState<LockMode>("idle");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setIsSet(isPinSet());
  }, []);

  const open = (m: LockMode) => {
    setMode(m);
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setNote(null);
  };
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

  const submit = async () => {
    setError(null);
    if (mode !== "remove") {
      if (!isValidPin(next)) return setError("The PIN must be exactly 4 digits");
      if (next !== confirm) return setError("The two PINs don't match");
    }
    if (mode !== "set") {
      // One verify: a miss counts once here; a hit resets the counter, so the
      // change/remove below re-verifies the same PIN against a clean record.
      const v = await verifyPin(current);
      if (v.kind !== "ok") return setError(describeVerify(v));
    }
    if (mode === "remove") await clearPin(current);
    else await setPin(next, mode === "change" ? current : undefined);
    setIsSet(mode !== "remove");
    const done = mode === "remove" ? "Parental lock removed" : mode === "change" ? "PIN changed" : "Parental lock on";
    open("idle");
    setNote(done);
  };

  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="fld" style={{ marginBottom: 10 }}>
      {label}
      <input
        type="password"
        inputMode="numeric"
        maxLength={4}
        autoComplete="off"
        value={value}
        onChange={(e) => set(digits(e.target.value))}
      />
    </label>
  );

  return (
    <section className="panel" aria-label="Parental lock">
      <h3>Parental lock</h3>
      <div className="setrow">
        <div className="d">
          Require a PIN for U/A 16+ and A titles<span>{isSet ? "PIN is set on this browser" : "Off"}</span>
        </div>
        {mode === "idle" && !isSet && (
          <button className="btn s sm" onClick={() => open("set")}>
            Set a PIN
          </button>
        )}
        {mode === "idle" && isSet && (
          <span style={{ display: "flex", gap: 6 }}>
            <button className="btn s sm" onClick={() => open("change")}>Change</button>
            <button className="btn s sm" onClick={() => open("remove")}>Remove</button>
          </span>
        )}
      </div>
      {note && <p className="muted" role="status" style={{ fontSize: 13, margin: "8px 0 0" }}>{note}</p>}
      {mode !== "idle" && (
        <form
          className="lockform"
          aria-label={mode === "set" ? "Set a PIN" : mode === "change" ? "Change PIN" : "Remove PIN"}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {mode !== "set" && field("Current PIN", current, setCurrent)}
          {mode !== "remove" && field("New PIN", next, setNext)}
          {mode !== "remove" && field("Confirm new PIN", confirm, setConfirm)}
          {error && (
            <p role="alert" style={{ color: "var(--danger, #e5484d)", fontSize: 13, margin: "0 0 10px" }}>
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn p sm" type="submit">
              {mode === "remove" ? "Remove lock" : "Save PIN"}
            </button>
            <button className="btn s sm" type="button" onClick={() => open("idle")}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <p className="muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
        The PIN is kept only in this browser as a salted hash. Set it again on each device you share.
      </p>
    </section>
  );
}

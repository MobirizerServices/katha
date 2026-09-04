"use client";
import { useState } from "react";
import Link from "next/link";
import { verifyPin, type Verify } from "@/lib/parentalLock";

/** Wording for a failed PIN check, shared by the player gate and the settings. */
export function describeVerify(v: Exclude<Verify, { kind: "ok" }>): string {
  if (v.kind === "lockedOut") return `Too many attempts — try again in ${v.seconds}s`;
  return v.attemptsLeft > 0
    ? `That PIN didn't match — ${v.attemptsLeft} ${v.attemptsLeft === 1 ? "attempt" : "attempts"} left`
    : "That PIN didn't match";
}

/**
 * Asked before a U/A 16+ or A series plays when a parental PIN is set. Sits
 * over the player stage; nothing is fetched behind it until it clears.
 */
export default function PinGate({
  rating,
  backHref,
  onUnlocked,
}: {
  rating: string;
  backHref: string;
  onUnlocked: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    const v = await verifyPin(pin);
    setBusy(false);
    setPin("");
    if (v.kind === "ok") onUnlocked();
    else setError(describeVerify(v));
  };

  return (
    <div className="overlay">
      <form
        className="ocard"
        aria-label="Parental lock"
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
      >
        <h3>Parental lock</h3>
        <p>This series is rated {rating}. Enter the 4-digit PIN to play it.</p>
        <input
          className="pininput"
          type="password"
          inputMode="numeric"
          maxLength={4}
          autoComplete="off"
          value={pin}
          aria-label="Parental PIN"
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
        />
        {error && (
          <p role="alert" style={{ color: "var(--danger, #e5484d)", fontSize: 13, margin: "0 0 12px" }}>
            {error}
          </p>
        )}
        <button className="btn p" type="submit" disabled={busy || pin.length !== 4}>
          {busy ? "Checking…" : "Unlock"}
        </button>
        <Link className="olink" href={backHref}>
          Back to the series
        </Link>
      </form>
    </div>
  );
}

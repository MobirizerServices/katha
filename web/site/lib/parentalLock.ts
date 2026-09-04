// The parental PIN (IT Rules 2021 gate for U/A 16+ and A titles) — the web
// twin of ios/KathaApp/ParentalLock.swift, with the same semantics:
//
// * stored as a salted SHA-256 digest (WebCrypto) — never the digits;
// * five free attempts, then an exponentially growing lockout (30 s, doubling
//   per further miss, capped at an hour) so the 10,000-combo space cannot be
//   walked;
// * changing or removing the lock requires the current PIN, so the child the
//   lock gates cannot switch it off from the profile page.
//
// localStorage is the only store a browser has; it is per-origin and the
// digest is useless without the salt + a brute force the lockout throttles.

const KEY = "katha.parental.v1";
export const MAX_FREE_ATTEMPTS = 5;

interface LockRecord {
  hash: string;
  salt: string;
  failures: number;
  lockedUntil: number; // epoch ms, 0 when not locked out
}

export type Verify =
  | { kind: "ok" }
  | { kind: "wrong"; attemptsLeft: number }
  | { kind: "lockedOut"; seconds: number };

function read(): LockRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LockRecord) : null;
  } catch {
    return null;
  }
}
function write(rec: LockRecord | null) {
  try {
    if (rec) localStorage.setItem(KEY, JSON.stringify(rec));
    else localStorage.removeItem(KEY);
  } catch { /* storage-hostile browser: the lock simply isn't remembered */ }
}

/** Does a series with this rating sit behind the PIN? U/A 16+ and A do. */
export function needsPin(rating: string): boolean {
  return rating === "A" || rating.startsWith("U/A 16");
}

export function isPinSet(): boolean {
  return read() !== null;
}

/** Seconds until attempts are accepted again (0 when not locked out). */
export function lockoutRemaining(now = Date.now()): number {
  const rec = read();
  if (!rec) return 0;
  return Math.max(0, Math.ceil((rec.lockedUntil - now) / 1000));
}

async function digest(pin: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function newSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

/** Store a new PIN. Requires the current one when a lock already exists. */
export async function setPin(pin: string, current?: string): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  if (isPinSet()) {
    const v = await verifyPin(current ?? "");
    if (v.kind !== "ok") return false;
  }
  const salt = newSalt();
  write({ hash: await digest(pin, salt), salt, failures: 0, lockedUntil: 0 });
  return true;
}

/** Remove the lock. Requires the current PIN. */
export async function clearPin(current: string): Promise<boolean> {
  const v = await verifyPin(current);
  if (v.kind !== "ok") return false;
  write(null);
  return true;
}

export async function verifyPin(pin: string, now = Date.now()): Promise<Verify> {
  const rec = read();
  if (!rec) return { kind: "wrong", attemptsLeft: 0 };
  const wait = lockoutRemaining(now);
  if (wait > 0) return { kind: "lockedOut", seconds: wait };

  if (constantTimeEqual(await digest(pin, rec.salt), rec.hash)) {
    write({ ...rec, failures: 0, lockedUntil: 0 });
    return { kind: "ok" };
  }
  const failures = rec.failures + 1;
  if (failures >= MAX_FREE_ATTEMPTS) {
    // 30 s after the 5th miss, doubling each further miss, capped at an hour.
    const extra = Math.min(failures - MAX_FREE_ATTEMPTS, 7);
    const seconds = Math.min(30 * (1 << extra), 3600);
    write({ ...rec, failures, lockedUntil: now + seconds * 1000 });
    return { kind: "lockedOut", seconds };
  }
  write({ ...rec, failures });
  return { kind: "wrong", attemptsLeft: MAX_FREE_ATTEMPTS - failures };
}

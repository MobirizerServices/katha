import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  MAX_FREE_ATTEMPTS, clearPin, isPinSet, isValidPin, lockoutRemaining, needsPin, setPin, verifyPin,
} from "@/lib/parentalLock";
import { CAPTIONS_OFF, getCaptionPref, setCaptionPref } from "@/lib/prefs";

const KEY = "katha.parental.v1";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("needsPin — which ratings sit behind the lock", () => {
  it("gates A and U/A 16+, not the younger ratings", () => {
    expect(needsPin("A")).toBe(true);
    expect(needsPin("U/A 16+")).toBe(true);
    expect(needsPin("U/A 13+")).toBe(false);
    expect(needsPin("U/A 7+")).toBe(false);
    expect(needsPin("U")).toBe(false);
  });
});

describe("set / verify / clear — mirrors the iOS ParentalLock", () => {
  it("with no lock: nothing is set, verify is a miss with no attempts, clear fails", async () => {
    expect(isPinSet()).toBe(false);
    expect(lockoutRemaining()).toBe(0);
    expect(await verifyPin("1234")).toEqual({ kind: "wrong", attemptsLeft: 0 });
    expect(await clearPin("1234")).toBe(false);
  });

  it("stores a salted SHA-256 digest, never the digits", async () => {
    expect(await setPin("1234")).toBe(true);
    const raw = localStorage.getItem(KEY)!;
    expect(raw).not.toContain("1234");
    const rec = JSON.parse(raw);
    expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.salt.length).toBeGreaterThan(10);
    expect(isPinSet()).toBe(true);
    expect(await verifyPin("1234")).toEqual({ kind: "ok" });
    expect(await verifyPin("0000")).toEqual({ kind: "wrong", attemptsLeft: MAX_FREE_ATTEMPTS - 1 });
  });

  it("refuses anything but exactly four digits", async () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("abcd")).toBe(false);
    expect(await setPin("12")).toBe(false);
    expect(isPinSet()).toBe(false);
  });

  it("changing requires the current PIN and re-salts", async () => {
    await setPin("1234");
    const salt1 = JSON.parse(localStorage.getItem(KEY)!).salt;
    expect(await setPin("9999")).toBe(false);            // no current PIN given
    expect(await setPin("9999", "0000")).toBe(false);    // wrong current PIN
    expect(await setPin("9999", "1234")).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!).salt).not.toBe(salt1);
    expect(await verifyPin("9999")).toEqual({ kind: "ok" });
    expect((await verifyPin("1234")).kind).toBe("wrong");
  });

  it("removing requires the current PIN", async () => {
    await setPin("1234");
    expect(await clearPin("0000")).toBe(false);
    expect(isPinSet()).toBe(true);
    expect(await clearPin("1234")).toBe(true);
    expect(isPinSet()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("five misses lock the pad for 30 s, doubling per further miss, capped at an hour; a hit resets", async () => {
    await setPin("1234");
    let now = 1_000_000_000_000;
    for (let left = 4; left >= 1; left--)
      expect(await verifyPin("0000", now)).toEqual({ kind: "wrong", attemptsLeft: left });
    expect(await verifyPin("0000", now)).toEqual({ kind: "lockedOut", seconds: 30 });
    expect(lockoutRemaining(now)).toBe(30);
    // during the lockout even the right PIN is refused
    expect(await verifyPin("1234", now + 1000)).toEqual({ kind: "lockedOut", seconds: 29 });
    // after it, every further miss doubles the wait, capped at 3600 s
    const expected = [60, 120, 240, 480, 960, 1920, 3600, 3600];
    for (const seconds of expected) {
      now += lockoutRemaining(now) * 1000 + 1000;
      expect(await verifyPin("0000", now)).toEqual({ kind: "lockedOut", seconds });
    }
    now += 3601 * 1000;
    expect(await verifyPin("1234", now)).toEqual({ kind: "ok" });
    expect(lockoutRemaining(now)).toBe(0);
    expect(await verifyPin("0000", now)).toEqual({ kind: "wrong", attemptsLeft: MAX_FREE_ATTEMPTS - 1 });
  });

  it("survives a storage-hostile browser without throwing", async () => {
    for (const m of ["getItem", "setItem", "removeItem"] as const)
      vi.spyOn(Storage.prototype, m).mockImplementation(() => { throw new Error("blocked"); });
    expect(isPinSet()).toBe(false);
    expect(await setPin("1234")).toBe(true);     // accepted, simply not remembered
    expect(isPinSet()).toBe(false);
    expect(await clearPin("1234")).toBe(false);
  });
});

describe("caption preference", () => {
  it("remembers the last choice and tolerates a blocked store", () => {
    expect(getCaptionPref()).toBeNull();
    setCaptionPref("en");
    expect(getCaptionPref()).toBe("en");
    setCaptionPref(CAPTIONS_OFF);
    expect(getCaptionPref()).toBe("off");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => setCaptionPref("hi")).not.toThrow();
    expect(getCaptionPref()).toBeNull();
  });
});

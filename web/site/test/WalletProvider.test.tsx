import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider, useWallet, type WalletCtx } from "@/components/WalletProvider";

// ---- mock the live api client -------------------------------------------
const getTokenMock = vi.fn<() => string | null>();
const clearTokenMock = vi.fn();
const guestLogin = vi.fn();
const otpLogin = vi.fn();
const wallet = vi.fn();
const webOrder = vi.fn();
const unlockEpisode = vi.fn();
const unlockAll = vi.fn();

vi.mock("@/lib/api", () => ({
  getToken: () => getTokenMock(),
  clearToken: () => clearTokenMock(),
  api: {
    guestLogin: (...a: unknown[]) => guestLogin(...a),
    otpLogin: (...a: unknown[]) => otpLogin(...a),
    wallet: (...a: unknown[]) => wallet(...a),
    webOrder: (...a: unknown[]) => webOrder(...a),
    unlockEpisode: (...a: unknown[]) => unlockEpisode(...a),
    unlockAll: (...a: unknown[]) => unlockAll(...a),
  },
}));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Probe captures the live context so tests can call actions + read state.
let ctx: WalletCtx;
function Probe() {
  ctx = useWallet();
  return <div data-testid="balance">{ctx.balance}</div>;
}

function renderWallet() {
  return render(
    <WalletProvider>
      <Probe />
    </WalletProvider>
  );
}

// Mount and wait until the hydration effect has finished (ready === true).
async function mountReady(w: { balance_bought: number; balance_bonus: number }) {
  wallet.mockResolvedValue({ ...w, total: w.balance_bought + w.balance_bonus });
  renderWallet();
  await waitFor(() => expect(ctx.ready).toBe(true));
}

beforeEach(() => {
  localStorage.clear();
  getTokenMock.mockReturnValue(null);
  guestLogin.mockResolvedValue("guest-tok");
});

describe("hydration", () => {
  it("establishes a guest session and reconciles the wallet from the server", async () => {
    await mountReady({ balance_bought: 40, balance_bonus: 20 });
    expect(guestLogin).toHaveBeenCalledTimes(1);
    expect(wallet).toHaveBeenCalled();
    expect(ctx.bought).toBe(40);
    expect(ctx.bonus).toBe(20);
    expect(ctx.balance).toBe(60);
    expect(screen.getByTestId("balance").textContent).toBe("60");
  });

  it("skips guestLogin when a token already exists", async () => {
    getTokenMock.mockReturnValue("existing-tok");
    await mountReady({ balance_bought: 5, balance_bonus: 0 });
    expect(guestLogin).not.toHaveBeenCalled();
  });

  it("falls back to cached view when the API is offline", async () => {
    localStorage.setItem(
      "katha.wallet.v1",
      JSON.stringify({ signed: true, phone: "+91 1", name: "Meera", bought: 7, bonus: 3, unlocked: {} })
    );
    guestLogin.mockRejectedValue(new Error("offline"));
    wallet.mockRejectedValue(new Error("offline"));
    renderWallet();
    await waitFor(() => expect(ctx.ready).toBe(true));
    expect(ctx.balance).toBe(10);
    expect(ctx.signed).toBe(true);
  });
});

describe("unlockEpisode — bonus-first spend", () => {
  it("spends bonus before bought, fires the ledger unlock, then reconciles", async () => {
    await mountReady({ balance_bought: 40, balance_bonus: 20 });
    const d = deferred<{ wallet: { balance_bought: number; balance_bonus: number }; spent_bonus: number; spent_bought: number }>();
    unlockEpisode.mockReturnValue(d.promise);

    let ok = false;
    act(() => {
      ok = ctx.unlockEpisode("ceo-sahab", 11, 30);
    });
    expect(ok).toBe(true);

    // Optimistic state: 20 bonus consumed first, then 10 from bought.
    expect(ctx.bonus).toBe(0);
    expect(ctx.bought).toBe(30);
    expect(ctx.balance).toBe(30);
    expect(ctx.hasUnlocked("ceo-sahab", 11)).toBe(true);
    expect(unlockEpisode).toHaveBeenCalledWith("ceo-sahab", 11, expect.stringContaining("unlock:ceo-sahab:11"));

    // Server reconciliation overrides the optimistic numbers.
    await act(async () => {
      d.resolve({ wallet: { balance_bought: 28, balance_bonus: 1 }, spent_bonus: 20, spent_bought: 10 });
      await d.promise;
    });
    expect(ctx.bought).toBe(28);
    expect(ctx.bonus).toBe(1);
  });

  it("returns false and does NOT call the API when funds are insufficient", async () => {
    await mountReady({ balance_bought: 5, balance_bonus: 5 });
    let ok = true;
    act(() => {
      ok = ctx.unlockEpisode("ceo-sahab", 11, 30);
    });
    expect(ok).toBe(false);
    expect(unlockEpisode).not.toHaveBeenCalled();
    expect(ctx.balance).toBe(10);
  });

  it("restores the balance from the server when the unlock fails", async () => {
    await mountReady({ balance_bought: 40, balance_bonus: 20 });
    unlockEpisode.mockRejectedValue(new Error("boom"));
    // refreshWallet re-reads the authoritative wallet after failure.
    wallet.mockResolvedValueOnce({ balance_bought: 40, balance_bonus: 20, total: 60 });
    await act(async () => {
      ctx.unlockEpisode("ceo-sahab", 11, 30);
      await Promise.resolve();
    });
    await waitFor(() => expect(ctx.bought).toBe(40));
    expect(ctx.bonus).toBe(20);
  });
});

describe("unlockBundle", () => {
  it("marks the whole series unlocked and reconciles", async () => {
    await mountReady({ balance_bought: 2000, balance_bonus: 0 });
    const d = deferred<{ wallet: { balance_bought: number; balance_bonus: number }; episode_ids: string[] }>();
    unlockAll.mockReturnValue(d.promise);
    let ok = false;
    act(() => {
      ok = ctx.unlockBundle("ceo-sahab", 1395);
    });
    expect(ok).toBe(true);
    expect(ctx.bought).toBe(605);
    expect(ctx.hasUnlocked("ceo-sahab", 11)).toBe(true);
    expect(ctx.hasUnlocked("ceo-sahab", 72)).toBe(true); // "all"
    await act(async () => {
      d.resolve({ wallet: { balance_bought: 605, balance_bonus: 0 }, episode_ids: ["e11"] });
      await d.promise;
    });
    expect(ctx.bought).toBe(605);
  });

  it("returns false when the bundle is unaffordable", async () => {
    await mountReady({ balance_bought: 100, balance_bonus: 0 });
    let ok = true;
    act(() => {
      ok = ctx.unlockBundle("ceo-sahab", 1395);
    });
    expect(ok).toBe(false);
    expect(unlockAll).not.toHaveBeenCalled();
  });
});

describe("purchase — optimistic credit then reconcile", () => {
  it("credits base + 10% web bonus immediately, then reconciles from the web order", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    const d = deferred<{ balance_bought: number; balance_bonus: number }>();
    webOrder.mockReturnValue(d.promise);

    act(() => {
      ctx.purchase(1300, 199, "coins_popular_in");
    });
    // Optimistic: +1300 bought, +130 web bonus.
    expect(ctx.bought).toBe(1300);
    expect(ctx.bonus).toBe(130);
    expect(ctx.balance).toBe(1430);
    expect(webOrder).toHaveBeenCalledWith("coins_popular_in");

    await act(async () => {
      d.resolve({ balance_bought: 1300, balance_bonus: 200 });
      await d.promise;
    });
    // Server view wins on reconciliation.
    expect(ctx.bonus).toBe(200);
  });

  it("clears firstPack once the starter pack is bought", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    webOrder.mockResolvedValue({ balance_bought: 600, balance_bonus: 60 });
    expect(ctx.firstPack).toBe(true);
    await act(async () => {
      ctx.purchase(600, 99, "coins_starter_in");
      await Promise.resolve();
    });
    expect(ctx.firstPack).toBe(false);
  });
});

describe("sign in / out", () => {
  it("signIn OTP-authenticates, marks signed, and loads that user's wallet", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    otpLogin.mockResolvedValue("otp-tok");
    wallet.mockResolvedValueOnce({ balance_bought: 900, balance_bonus: 100, total: 1000 });
    await act(async () => {
      ctx.signIn("+91 90000 00000");
      await Promise.resolve();
    });
    await waitFor(() => expect(ctx.signed).toBe(true));
    expect(otpLogin).toHaveBeenCalledWith("+91 90000 00000", "1234");
    expect(ctx.phone).toBe("+91 90000 00000");
    expect(ctx.name).toBe("Meera");
    expect(ctx.bought).toBe(900);
  });

  it("signIn still signs the user in when the OTP call fails", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    otpLogin.mockRejectedValue(new Error("network"));
    await act(async () => {
      ctx.signIn("+91 1");
      await Promise.resolve();
    });
    await waitFor(() => expect(ctx.signed).toBe(true));
    expect(ctx.phone).toBe("+91 1");
  });

  it("signOut clears the token, resets the wallet, and re-establishes a guest session", async () => {
    await mountReady({ balance_bought: 500, balance_bonus: 50 });
    wallet.mockResolvedValueOnce({ balance_bought: 0, balance_bonus: 0, total: 0 });
    act(() => {
      ctx.signOut();
    });
    expect(clearTokenMock).toHaveBeenCalled();
    expect(ctx.signed).toBe(false);
    expect(ctx.bought).toBe(0);
    expect(ctx.bonus).toBe(0);
    expect(Object.keys(ctx.unlocked)).toHaveLength(0);
  });
});

describe("sign-in modal + toast (UI)", () => {
  it("openSignIn shows the modal; the OTP flow verifies and signs in", async () => {
    const user = userEvent.setup();
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    otpLogin.mockResolvedValue("t");
    wallet.mockResolvedValue({ balance_bought: 0, balance_bonus: 0, total: 0 });

    act(() => {
      ctx.openSignIn(); // no redirect href -> no post-verify navigation
    });
    expect(screen.getByRole("dialog", { name: "Sign in" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send code" }));
    // OTP step: type one digit into each box (drives setDigit + auto-advance).
    const boxes = screen.getAllByLabelText(/Digit \d/);
    expect(boxes).toHaveLength(4);
    await user.type(boxes[0] as HTMLElement, "1");
    await user.type(boxes[1] as HTMLElement, "2");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(ctx.signed).toBe(true));
  });

  it("toast renders a live-region status message", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    act(() => {
      ctx.toast("Hello there");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Hello there");
  });
});

describe("useWallet guard", () => {
  it("throws when used outside a WalletProvider", () => {
    const Bad = () => {
      useWallet();
      return null;
    };
    // suppress the expected React error boundary console noise
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bad />)).toThrow(/useWallet must be used within WalletProvider/);
    spy.mockRestore();
  });
});

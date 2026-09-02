import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, act, waitFor, within } from "@testing-library/react";
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
    // the third arg is the per-checkout payment id keying idempotency
    expect(webOrder).toHaveBeenCalledWith("coins_popular_in", "", expect.any(String));

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

describe("failure directions & edge branches", () => {
  it("hydrates even when localStorage itself throws", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    wallet.mockResolvedValue({ balance_bought: 1, balance_bonus: 0, total: 1 });
    renderWallet();
    await waitFor(() => expect(ctx.ready).toBe(true));
    expect(ctx.balance).toBe(1);
    spy.mockRestore();
  });

  it("persists best-effort: a throwing setItem never breaks state", async () => {
    await mountReady({ balance_bought: 40, balance_bonus: 0 });
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    unlockEpisode.mockRejectedValue(new Error("down"));
    wallet.mockResolvedValue({ balance_bought: 40, balance_bonus: 0, total: 40 });
    act(() => { ctx.unlockEpisode("ceo-sahab", 11, 30); });
    // server refused → optimistic spend restored + toast; a second failure
    // while the first toast is live exercises the timer-clear branch
    await waitFor(() => expect(ctx.balance).toBe(40));
    act(() => { ctx.unlockEpisode("ceo-sahab", 12, 30); });
    await waitFor(() => expect(ctx.balance).toBe(40));
    spy.mockRestore();
  });

  it("refuses to spend beyond the balance", async () => {
    await mountReady({ balance_bought: 10, balance_bonus: 0 });
    let ok = true;
    act(() => { ok = ctx.unlockEpisode("ceo-sahab", 11, 30); });
    expect(ok).toBe(false);
    expect(ctx.balance).toBe(10);
    expect(unlockEpisode).not.toHaveBeenCalled();
  });

  it("unlocked-map grows arrays and respects an 'all' bundle", async () => {
    await mountReady({ balance_bought: 5000, balance_bonus: 0 });
    unlockEpisode.mockResolvedValue({ wallet: { balance_bought: 4900, balance_bonus: 0 },
                                      spent_bonus: 0, spent_bought: 30 });
    unlockAll.mockResolvedValue({ wallet: { balance_bought: 3700, balance_bonus: 0 } });
    wallet.mockResolvedValue({ balance_bought: 4000, balance_bonus: 0, total: 4000 });
    act(() => { ctx.unlockEpisode("ceo-sahab", 11, 30); });
    act(() => { ctx.unlockEpisode("ceo-sahab", 12, 30); });   // append to array
    await waitFor(() => expect(ctx.hasUnlocked("ceo-sahab", 12)).toBe(true));
    act(() => { ctx.unlockBundle("kaanch-ka-mahal", 1125); });
    await waitFor(() => expect(ctx.hasUnlocked("kaanch-ka-mahal", 60)).toBe(true));
    act(() => { ctx.unlockEpisode("kaanch-ka-mahal", 61, 30); });  // 'all' stays
    await waitFor(() => expect(ctx.hasUnlocked("kaanch-ka-mahal", 61)).toBe(true));
  });

  it("sign-in falls back offline, honors the after-href, and OTP UX works", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    // jsdom cannot navigate: capture the deferred redirect instead
    const timers: (() => void)[] = [];
    const realSetTimeout = window.setTimeout;
    vi.stubGlobal("setTimeout", ((fn: () => void, ms?: number) =>
      ms === 60 ? (timers.push(fn), 0 as never)
                : realSetTimeout(fn, ms)) as never);
    act(() => { ctx.openSignIn("/coins"); });
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByText("Send code"));   // phone → otp
    const d1 = within(dialog).getByLabelText("Digit 1");
    const d2 = within(dialog).getByLabelText("Digit 2");
    // backspace on an empty second box moves focus back to the first
    await userEvent.type(d1, "1");
    d2.focus();
    await userEvent.keyboard("{Backspace}");
    expect(document.activeElement).toBe(d1);
    // verify with an EMPTY phone → the placeholder number is used
    otpLogin.mockRejectedValue(new Error("offline"));
    await userEvent.click(within(dialog).getByText("Verify"));
    await waitFor(() => expect(ctx.signed).toBe(true));
    expect(otpLogin).toHaveBeenCalledWith("+91 98765 43210", expect.anything());
    expect(timers.length).toBe(1);            // the deferred redirect was queued
    vi.unstubAllGlobals();
  });
});

describe("reconcile + typed-phone stragglers", () => {
  it("a failed purchase falls back to a server wallet refresh", async () => {
    await mountReady({ balance_bought: 100, balance_bonus: 0 });
    webOrder.mockRejectedValue(new Error("gateway down"));
    wallet.mockResolvedValue({ balance_bought: 100, balance_bonus: 0, total: 100 });
    act(() => { ctx.purchase(600, 99, "coins_starter_in"); });
    await waitFor(() => expect(wallet).toHaveBeenCalled());
    expect(ctx.balance).toBe(100);
  });

  it("a typed phone is used verbatim at verify", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    otpLogin.mockRejectedValue(new Error("offline"));
    act(() => { ctx.openSignIn(); });
    const dialog = await screen.findByRole("dialog");
    const phoneInput = within(dialog).getByPlaceholderText("+91 98765 43210");
    await userEvent.clear(phoneInput);
    await userEvent.type(phoneInput, "+91 90000 11111");
    await userEvent.click(within(dialog).getByText("Send code"));
    await userEvent.click(within(dialog).getByText("Verify"));
    await waitFor(() => expect(ctx.signed).toBe(true));
    expect(otpLogin).toHaveBeenCalledWith("+91 90000 11111", expect.anything());
  });
});

describe("invoice email pass-through", () => {
  it("purchase forwards the checkout email to the web order", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    webOrder.mockResolvedValue({ balance_bought: 1300, balance_bonus: 130, total: 1430 });
    act(() => { ctx.purchase(1300, 199, "coins_popular_in", "meera@example.com"); });
    await waitFor(() =>
      expect(webOrder).toHaveBeenCalledWith("coins_popular_in", "meera@example.com", expect.any(String)));
  });
});

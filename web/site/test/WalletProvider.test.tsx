import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider, useWallet, type WalletCtx } from "@/components/WalletProvider";

// ---- mock the live api client -------------------------------------------
const getTokenMock = vi.fn<() => string | null>();
const clearTokenMock = vi.fn();
const guestLogin = vi.fn();
const otpRequest = vi.fn();
const otpLogin = vi.fn();
const me = vi.fn();
const wallet = vi.fn();
const webOrder = vi.fn();
const unlockEpisode = vi.fn();
const unlockAll = vi.fn();

vi.mock("@/lib/api", () => ({
  getToken: () => getTokenMock(),
  clearToken: () => clearTokenMock(),
  api: {
    guestLogin: (...a: unknown[]) => guestLogin(...a),
    otpRequest: (...a: unknown[]) => otpRequest(...a),
    otpLogin: (...a: unknown[]) => otpLogin(...a),
    me: (...a: unknown[]) => me(...a),
    wallet: (...a: unknown[]) => wallet(...a),
    webOrder: (...a: unknown[]) => webOrder(...a),
    unlockEpisode: (...a: unknown[]) => unlockEpisode(...a),
    unlockAll: (...a: unknown[]) => unlockAll(...a),
  },
}));

type Profile = { user_id: string; kind: string; display_name: string; language: string; phone: string | null };
const GUEST: Profile = { user_id: "g", kind: "guest", display_name: "", language: "hi", phone: null };
const MEMBER: Profile = { user_id: "m", kind: "phone", display_name: "Asha", language: "hi", phone: "+91 90000 00000" };
const W = (bought: number, bonus: number) => ({ balance_bought: bought, balance_bonus: bonus, total: bought + bonus });
const UNLOCK = (bought: number, bonus: number, spentBonus: number, spentBought: number) => ({
  wallet: W(bought, bonus), spent_bonus: spentBonus, spent_bought: spentBought, episode_ids: ["x"],
});

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
async function mountReady(w: { balance_bought: number; balance_bonus: number }, profile = GUEST) {
  wallet.mockResolvedValue({ ...w, total: w.balance_bought + w.balance_bonus });
  me.mockResolvedValue(profile);
  renderWallet();
  await waitFor(() => expect(ctx.ready).toBe(true));
}

beforeEach(() => {
  localStorage.clear();
  getTokenMock.mockReturnValue(null);
  guestLogin.mockResolvedValue("guest-tok");
  otpRequest.mockResolvedValue({});
});

describe("hydration", () => {
  it("establishes a guest session and takes wallet AND identity from the server", async () => {
    await mountReady({ balance_bought: 40, balance_bonus: 20 });
    expect(guestLogin).toHaveBeenCalledTimes(1);
    expect(ctx.bought).toBe(40);
    expect(ctx.bonus).toBe(20);
    expect(ctx.balance).toBe(60);
    expect(ctx.signed).toBe(false);
    expect(screen.getByTestId("balance").textContent).toBe("60");
  });

  it("a member token hydrates as signed in from the profile, not from a cached flag", async () => {
    getTokenMock.mockReturnValue("existing-tok");
    localStorage.setItem("katha.wallet.v2", JSON.stringify({ signed: false, name: "stale" }));
    await mountReady({ balance_bought: 5, balance_bonus: 0 }, MEMBER);
    expect(guestLogin).not.toHaveBeenCalled();
    expect(ctx.signed).toBe(true);
    expect(ctx.name).toBe("Asha");
    expect(ctx.phone).toBe("+91 90000 00000");
  });

  it("falls back to the cached display view when the API is offline", async () => {
    localStorage.setItem(
      "katha.wallet.v2",
      JSON.stringify({ signed: true, phone: "+91 1", name: "Meera", bought: 7, bonus: 3 })
    );
    guestLogin.mockRejectedValue(new Error("offline"));
    wallet.mockRejectedValue(new Error("offline"));
    me.mockRejectedValue(new Error("offline"));
    renderWallet();
    await waitFor(() => expect(ctx.ready).toBe(true));
    expect(ctx.balance).toBe(10);
    expect(ctx.signed).toBe(true);
  });
});

describe("unlockEpisode — the ledger answers, the wallet follows", () => {
  it("awaits the server, reconciles the wallet from its answer, reports the spend", async () => {
    await mountReady({ balance_bought: 40, balance_bonus: 20 });
    unlockEpisode.mockResolvedValue(UNLOCK(30, 0, 20, 10));
    let out: Awaited<ReturnType<WalletCtx["unlockEpisode"]>> | undefined;
    await act(async () => {
      out = await ctx.unlockEpisode("ceo-sahab", 11);
    });
    expect(out).toEqual({ ok: true, spent: 30 });
    expect(unlockEpisode).toHaveBeenCalledWith("ceo-sahab", 11, expect.stringContaining("unlock:ceo-sahab:11"));
    expect(ctx.bonus).toBe(0);
    expect(ctx.bought).toBe(30);
  });

  it("a 402 from the ledger is reported as insufficient and the wallet is re-read, never guessed", async () => {
    await mountReady({ balance_bought: 5, balance_bonus: 5 });
    unlockEpisode.mockRejectedValue(Object.assign(new Error("402"), { status: 402 }));
    wallet.mockResolvedValue(W(5, 5));
    let out: Awaited<ReturnType<WalletCtx["unlockEpisode"]>> | undefined;
    await act(async () => {
      out = await ctx.unlockEpisode("ceo-sahab", 11);
    });
    expect(out).toEqual({ ok: false, reason: "insufficient" });
    expect(ctx.balance).toBe(10);
    expect(wallet).toHaveBeenCalledTimes(2);
  });

  it("any other failure is an error and leaves the balance at the server's value", async () => {
    await mountReady({ balance_bought: 40, balance_bonus: 20 });
    unlockEpisode.mockRejectedValue(new Error("boom"));
    wallet.mockResolvedValue(W(40, 20));
    let out: Awaited<ReturnType<WalletCtx["unlockEpisode"]>> | undefined;
    await act(async () => {
      out = await ctx.unlockEpisode("ceo-sahab", 11);
    });
    expect(out).toEqual({ ok: false, reason: "error" });
    expect(ctx.bought).toBe(40);
    expect(ctx.bonus).toBe(20);
  });
});

describe("unlockBundle", () => {
  it("reconciles from the bundle answer", async () => {
    await mountReady({ balance_bought: 2000, balance_bonus: 0 });
    unlockAll.mockResolvedValue(UNLOCK(605, 0, 0, 1395));
    let out: Awaited<ReturnType<WalletCtx["unlockBundle"]>> | undefined;
    await act(async () => {
      out = await ctx.unlockBundle("ceo-sahab");
    });
    expect(out).toEqual({ ok: true, spent: 1395 });
    expect(unlockAll).toHaveBeenCalledWith("ceo-sahab", expect.stringContaining("bundle:ceo-sahab"));
    expect(ctx.bought).toBe(605);
  });

  it("reports a refused bundle without touching the balance", async () => {
    await mountReady({ balance_bought: 100, balance_bonus: 0 });
    unlockAll.mockRejectedValue(Object.assign(new Error("402"), { status: 402 }));
    wallet.mockResolvedValue(W(100, 0));
    let out: Awaited<ReturnType<WalletCtx["unlockBundle"]>> | undefined;
    await act(async () => {
      out = await ctx.unlockBundle("ceo-sahab");
    });
    expect(out).toEqual({ ok: false, reason: "insufficient" });
    expect(ctx.balance).toBe(100);
  });
});

describe("purchase — credited only when the server says so", () => {
  it("does not touch the wallet until the order resolves, then toasts the server's delta", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    let resolve!: (v: unknown) => void;
    webOrder.mockReturnValue(new Promise((r) => { resolve = r; }));
    let pending!: Promise<number | null>;
    act(() => {
      pending = ctx.purchase("coins_popular_in", "meera@example.com");
    });
    expect(ctx.balance).toBe(0);                       // nothing optimistic
    expect(webOrder).toHaveBeenCalledWith("coins_popular_in", "meera@example.com", expect.any(String));
    await act(async () => {
      resolve(W(1300, 130));
      await pending;
    });
    expect(await pending).toBe(1430);
    expect(ctx.bought).toBe(1300);
    expect(ctx.bonus).toBe(130);
    expect(screen.getByRole("status")).toHaveTextContent("1,430 coins added · invoice emailed");
  });

  it("a failed order credits nothing, re-reads the wallet and says so", async () => {
    await mountReady({ balance_bought: 100, balance_bonus: 0 });
    webOrder.mockRejectedValue(new Error("gateway down"));
    wallet.mockResolvedValue(W(100, 0));
    let out: number | null = 0;
    await act(async () => {
      out = await ctx.purchase("coins_starter_in");
    });
    expect(out).toBeNull();
    expect(ctx.balance).toBe(100);
    expect(screen.getByRole("status")).toHaveTextContent("Payment couldn't be confirmed — nothing was charged");
  });

  it("uses a fallback payment id where crypto.randomUUID is unavailable (insecure origins)", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    webOrder.mockResolvedValue(W(600, 60));
    await act(async () => {
      await ctx.purchase("coins_starter_in");
    });
    expect(webOrder.mock.calls[0][2]).toMatch(/^web-/);
    Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
  });
});

describe("sign in / out", () => {
  it("signIn sends the typed code, then takes identity and wallet from the server", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    otpLogin.mockResolvedValue("otp-tok");
    wallet.mockResolvedValue(W(900, 100));
    me.mockResolvedValue(MEMBER);
    let ok = false;
    await act(async () => {
      ok = await ctx.signIn("+91 90000 00000", "4321");
    });
    expect(ok).toBe(true);
    expect(otpLogin).toHaveBeenCalledWith("+91 90000 00000", "4321");
    expect(ctx.signed).toBe(true);
    expect(ctx.name).toBe("Asha");
    expect(ctx.bought).toBe(900);
  });

  it("a rejected code does NOT sign the user in", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    otpLogin.mockRejectedValue(Object.assign(new Error("401"), { status: 401 }));
    let ok = true;
    await act(async () => {
      ok = await ctx.signIn("+91 1", "0000");
    });
    expect(ok).toBe(false);
    expect(ctx.signed).toBe(false);
    expect(ctx.phone).toBe("");
    expect(screen.getByRole("status")).toHaveTextContent(/That code didn't work/);
  });

  it("a verified code whose profile read then fails still signs in by phone", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    otpLogin.mockResolvedValue("otp-tok");
    wallet.mockRejectedValue(new Error("flaky"));
    await act(async () => {
      await ctx.signIn("+91 2", "1111");
    });
    expect(ctx.signed).toBe(true);
    expect(ctx.phone).toBe("+91 2");
  });

  it("signOut clears the token, resets the wallet, and re-establishes a guest session", async () => {
    await mountReady({ balance_bought: 500, balance_bonus: 50 }, MEMBER);
    wallet.mockResolvedValue(W(0, 0));
    act(() => {
      ctx.signOut();
    });
    expect(clearTokenMock).toHaveBeenCalled();
    expect(ctx.signed).toBe(false);
    expect(ctx.bought).toBe(0);
    expect(ctx.bonus).toBe(0);
    await waitFor(() => expect(guestLogin).toHaveBeenCalledTimes(2));
  });
});

describe("sign-in modal + toast (UI)", () => {
  it("openSignIn shows the modal; the typed OTP is sent and a good code signs in", async () => {
    const user = userEvent.setup();
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    otpLogin.mockResolvedValue("t");
    wallet.mockResolvedValue(W(0, 0));
    me.mockResolvedValue(MEMBER);

    act(() => {
      ctx.openSignIn(); // no redirect href -> no post-verify navigation
    });
    expect(screen.getByRole("dialog", { name: "Sign in" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(otpRequest).toHaveBeenCalledWith("+91 98765 43210");
    const boxes = screen.getAllByLabelText(/Digit \d/);
    expect(boxes).toHaveLength(4);
    // an incomplete code never reaches the server
    await user.type(boxes[0] as HTMLElement, "1");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter all 4 digits");
    expect(otpLogin).not.toHaveBeenCalled();
    await user.type(boxes[1] as HTMLElement, "2");
    await user.type(boxes[2] as HTMLElement, "3");
    await user.type(boxes[3] as HTMLElement, "4");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(ctx.signed).toBe(true));
    expect(otpLogin).toHaveBeenCalledWith("+91 98765 43210", "1234");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a wrong code keeps the modal open with an error", async () => {
    const user = userEvent.setup();
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    otpRequest.mockRejectedValue(new Error("sms down"));     // delivery hiccup: still proceeds to the code step
    otpLogin.mockRejectedValue(Object.assign(new Error("401"), { status: 401 }));
    act(() => { ctx.openSignIn(); });
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Send code"));
    for (let i = 0; i < 4; i++) await user.type(within(dialog).getByLabelText(`Digit ${i + 1}`), "9");
    await user.click(within(dialog).getByText("Verify"));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent(/didn't match/));
    expect(ctx.signed).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
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
    wallet.mockResolvedValue(W(1, 0));
    me.mockResolvedValue(GUEST);
    renderWallet();
    await waitFor(() => expect(ctx.ready).toBe(true));
    expect(ctx.balance).toBe(1);
    spy.mockRestore();
  });

  it("persists best-effort: a throwing setItem never breaks state, and back-to-back toasts replace", async () => {
    await mountReady({ balance_bought: 40, balance_bonus: 0 });
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    act(() => { ctx.toast("one"); });
    act(() => { ctx.toast("two"); });
    expect(screen.getByRole("status")).toHaveTextContent("two");
    expect(ctx.balance).toBe(40);
    spy.mockRestore();
  });

  it("sign-in honors the after-href and the OTP boxes auto-advance and backspace", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    // jsdom cannot navigate: capture the deferred redirect instead
    const timers: (() => void)[] = [];
    const realSetTimeout = window.setTimeout;
    vi.stubGlobal("setTimeout", ((fn: () => void, ms?: number) =>
      ms === 60 ? (timers.push(fn), 0 as never)
                : realSetTimeout(fn, ms)) as never);
    otpLogin.mockResolvedValue("t");
    wallet.mockResolvedValue(W(0, 0));
    me.mockResolvedValue(MEMBER);
    act(() => { ctx.openSignIn("/coins"); });
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByText("Send code"));   // phone → otp
    const d1 = within(dialog).getByLabelText("Digit 1");
    const d2 = within(dialog).getByLabelText("Digit 2");
    await userEvent.type(d1, "1");
    expect(document.activeElement).toBe(d2);                        // auto-advance
    d2.focus();
    await userEvent.keyboard("{Backspace}");
    expect(document.activeElement).toBe(d1);                        // backspace on empty box
    for (const [i, ch] of ["2", "3", "4"].entries())
      await userEvent.type(within(dialog).getByLabelText(`Digit ${i + 2}`), ch);
    await userEvent.click(within(dialog).getByText("Verify"));
    await waitFor(() => expect(ctx.signed).toBe(true));
    expect(timers.length).toBe(1);            // the deferred redirect was queued
    vi.unstubAllGlobals();
  });

  it("a typed phone is used verbatim; an emptied phone falls back to the placeholder", async () => {
    await mountReady({ balance_bought: 0, balance_bonus: 0 });
    otpLogin.mockRejectedValue(new Error("offline"));
    act(() => { ctx.openSignIn(); });
    const dialog = await screen.findByRole("dialog");
    const phoneInput = within(dialog).getByPlaceholderText("+91 98765 43210");
    await userEvent.clear(phoneInput);
    await userEvent.type(phoneInput, "+91 90000 11111");
    await userEvent.click(within(dialog).getByText("Send code"));
    expect(otpRequest).toHaveBeenCalledWith("+91 90000 11111");
    for (let i = 0; i < 4; i++) await userEvent.type(within(dialog).getByLabelText(`Digit ${i + 1}`), "7");
    await userEvent.click(within(dialog).getByText("Verify"));
    await waitFor(() => expect(otpLogin).toHaveBeenCalledWith("+91 90000 11111", "7777"));
    expect(ctx.signed).toBe(false);

    // emptied phone → placeholder number (close the failed attempt, start over)
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    act(() => { ctx.openSignIn(); });
    const dialog2 = await screen.findByRole("dialog");
    await userEvent.clear(within(dialog2).getByPlaceholderText("+91 98765 43210"));
    await userEvent.click(within(dialog2).getByText("Send code"));
    expect(otpRequest).toHaveBeenLastCalledWith("+91 98765 43210");
  });
});

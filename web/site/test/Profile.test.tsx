import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WalletCtx } from "@/components/WalletProvider";
import { makeWallet } from "./walletStub";
import { isPinSet, setPin, verifyPin } from "@/lib/parentalLock";

let mockWallet: WalletCtx;
vi.mock("@/components/WalletProvider", () => ({ useWallet: () => mockWallet }));
const apiMock = vi.hoisted(() => ({ me: vi.fn(), signOutDevices: vi.fn(), deleteMe: vi.fn(), updateMe: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));

import Profile, { ParentalLockSettings } from "@/components/Profile";

const ME = { user_id: "m", kind: "phone" as const, display_name: "Asha", language: "hi", ui_language: "en", phone: "+91 98765 43221" };

beforeEach(() => {
  for (const f of Object.values(apiMock)) f.mockReset();
  apiMock.me.mockResolvedValue(ME);
  mockWallet = makeWallet({ signed: true, name: "Asha", phone: "+91 98765 43221", bought: 500, bonus: 50, balance: 550 });
});

describe("Profile — identity from /v1/me", () => {
  it("loads, then asks a guest to sign in", async () => {
    const user = userEvent.setup();
    mockWallet = makeWallet({ ready: false });
    const { rerender } = render(<Profile />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    const openSignIn = vi.fn();
    mockWallet = makeWallet({ signed: false, openSignIn });
    rerender(<Profile />);
    await user.click(screen.getByRole("button", { name: "Sign in with phone" }));
    expect(openSignIn).toHaveBeenCalledWith("/profile");
    expect(apiMock.me).not.toHaveBeenCalled();
  });

  it("shows the server profile with a masked phone, the wallet and the content language", async () => {
    render(<Profile />);
    expect(await screen.findByRole("heading", { name: "Asha" })).toBeInTheDocument();
    expect(screen.getAllByText("+91 98765 •••21")).toHaveLength(2);
    expect(screen.queryByText("+91 98765 43221")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Wallet" })).getByText("550")).toBeInTheDocument();
    const langs = screen.getByRole("group", { name: "Content language" });
    expect(within(langs).getByRole("button", { name: /Hindi/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to the wallet view when /v1/me fails, and copes with no phone / no name", async () => {
    const toast = vi.fn();
    apiMock.me.mockRejectedValue(new Error("down"));
    mockWallet = makeWallet({ signed: true, name: "", phone: "", toast });
    render(<Profile />);
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Couldn't load your profile — showing the last known view"));
    expect(screen.getByRole("heading", { name: "Member" })).toBeInTheDocument();
    expect(screen.getByText("Phone not on file")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("changes the content language through the server and reports a failure", async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    mockWallet = makeWallet({ signed: true, toast });
    apiMock.updateMe.mockResolvedValueOnce({ ...ME, language: "ta" }).mockRejectedValueOnce(new Error("down"));
    render(<Profile />);
    await screen.findByRole("heading", { name: "Asha" });
    const langs = screen.getByRole("group", { name: "Content language" });
    await user.click(within(langs).getByRole("button", { name: /Tamil/ }));
    expect(apiMock.updateMe).toHaveBeenCalledWith({ language: "ta" });
    await waitFor(() => expect(within(langs).getByRole("button", { name: /Tamil/ })).toHaveAttribute("aria-pressed", "true"));
    expect(toast).toHaveBeenLastCalledWith("Content language saved");
    await user.click(within(langs).getByRole("button", { name: /Telugu/ }));
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith("Couldn't save the language — try again"));
  });

  it("signs out other devices via the server, and signs out here via the wallet", async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    const signOut = vi.fn();
    mockWallet = makeWallet({ signed: true, toast, signOut });
    apiMock.signOutDevices.mockResolvedValueOnce(ME).mockRejectedValueOnce(new Error("down"));
    render(<Profile />);
    await user.click(await screen.findByRole("button", { name: "Sign out other devices" }));
    expect(apiMock.signOutDevices).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith("Signed out everywhere else — this browser stays signed in"));
    await user.click(screen.getByRole("button", { name: "Sign out other devices" }));
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith("Couldn't reach the server — nothing was changed"));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalled();
  });

  it("deleting the account needs a confirm step; the server answer drives the outcome", async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    const signOut = vi.fn();
    mockWallet = makeWallet({ signed: true, toast, signOut });
    apiMock.deleteMe.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({});
    render(<Profile />);
    await user.click(await screen.findByRole("button", { name: "Delete account" }));
    const dlg = screen.getByRole("alertdialog", { name: "Confirm account deletion" });
    await user.click(within(dlg).getByRole("button", { name: "Keep my account" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(apiMock.deleteMe).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete my account" }));
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith("Couldn't delete the account — try again"));
    expect(signOut).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Yes, delete my account" }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(toast).toHaveBeenLastCalledWith("Your account has been deleted");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("drops a profile answer that lands after unmount", async () => {
    let resolve!: (v: unknown) => void;
    apiMock.me.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const { unmount } = render(<Profile />);
    unmount();
    resolve(ME);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("heading", { name: "Asha" })).not.toBeInTheDocument();
  });
});

describe("ParentalLockSettings — set, change, remove, with the iOS rules", () => {
  const fields = () => ({
    current: screen.queryByLabelText("Current PIN") as HTMLInputElement | null,
    next: screen.queryByLabelText("New PIN") as HTMLInputElement | null,
    confirm: screen.queryByLabelText("Confirm new PIN") as HTMLInputElement | null,
  });

  it("sets a PIN: rejects short and mismatched PINs, then stores a hash", async () => {
    const user = userEvent.setup();
    render(<ParentalLockSettings />);
    expect(screen.getByText("Off")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set a PIN" }));
    const form = screen.getByRole("form", { name: "Set a PIN" });
    expect(fields().current).toBeNull();
    await user.type(fields().next!, "12a");
    await user.click(within(form).getByRole("button", { name: "Save PIN" }));
    expect(screen.getByRole("alert")).toHaveTextContent("exactly 4 digits");
    await user.type(fields().next!, "34");
    await user.type(fields().confirm!, "1235");
    await user.click(within(form).getByRole("button", { name: "Save PIN" }));
    expect(screen.getByRole("alert")).toHaveTextContent("don't match");
    await user.clear(fields().confirm!);
    await user.type(fields().confirm!, "1234");
    await user.click(within(form).getByRole("button", { name: "Save PIN" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Parental lock on");
    expect(screen.getByText("PIN is set on this browser")).toBeInTheDocument();
    expect(isPinSet()).toBe(true);
    expect(await verifyPin("1234")).toEqual({ kind: "ok" });
  });

  it("changing needs the current PIN (with attempts left on a miss); cancel closes the form", async () => {
    const user = userEvent.setup();
    await setPin("1234");
    render(<ParentalLockSettings />);
    await screen.findByText("PIN is set on this browser");
    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.type(fields().current!, "0000");
    await user.type(fields().next!, "5678");
    await user.type(fields().confirm!, "5678");
    await user.click(screen.getByRole("button", { name: "Save PIN" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That PIN didn't match — 4 attempts left");
    await user.clear(fields().current!);
    await user.type(fields().current!, "1234");
    await user.click(screen.getByRole("button", { name: "Save PIN" }));
    expect(await screen.findByRole("status")).toHaveTextContent("PIN changed");
    expect(await verifyPin("5678")).toEqual({ kind: "ok" });

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("form", { name: "Remove PIN" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("removing needs the current PIN; five misses lock the pad", async () => {
    const user = userEvent.setup();
    await setPin("1234");
    render(<ParentalLockSettings />);
    await screen.findByText("PIN is set on this browser");
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(fields().next).toBeNull();
    for (let i = 0; i < 4; i++) {
      await user.clear(fields().current!);
      await user.type(fields().current!, "0000");
      await user.click(screen.getByRole("button", { name: "Remove lock" }));
      await screen.findByRole("alert");
    }
    expect(screen.getByRole("alert")).toHaveTextContent("1 attempt left");
    await user.click(screen.getByRole("button", { name: "Remove lock" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts — try again in 30s"));
    // still locked out for the right PIN too
    await user.clear(fields().current!);
    await user.type(fields().current!, "1234");
    await user.click(screen.getByRole("button", { name: "Remove lock" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Too many attempts/));
    expect(isPinSet()).toBe(true);
    // clear the lockout and remove
    const rec = JSON.parse(localStorage.getItem("katha.parental.v1")!);
    localStorage.setItem("katha.parental.v1", JSON.stringify({ ...rec, lockedUntil: 0, failures: 0 }));
    await user.click(screen.getByRole("button", { name: "Remove lock" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Parental lock removed");
    expect(isPinSet()).toBe(false);
    expect(screen.getByRole("button", { name: "Set a PIN" })).toBeInTheDocument();
  });
});

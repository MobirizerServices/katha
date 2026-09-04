import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WalletCtx } from "@/components/WalletProvider";
import { makeWallet } from "./walletStub";
import { setPin } from "@/lib/parentalLock";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: any) =>
    React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
let mockWallet: WalletCtx;
vi.mock("@/components/WalletProvider", () => ({ useWallet: () => mockWallet }));

import PinGate, { describeVerify } from "@/components/PinGate";
import PitchForm, { pitchMailto, PARTNERS_EMAIL } from "@/components/PitchForm";

beforeEach(() => {
  mockWallet = makeWallet();
});

describe("PinGate", () => {
  it("only accepts four digits, reports misses with attempts left, and unlocks on the right PIN", async () => {
    const user = userEvent.setup();
    await setPin("2468");
    const onUnlocked = vi.fn();
    render(<PinGate rating="U/A 16+" backHref="/series/x" onUnlocked={onUnlocked} />);
    expect(screen.getByText(/rated U\/A 16\+/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the series" })).toHaveAttribute("href", "/series/x");
    const box = screen.getByLabelText("Parental PIN") as HTMLInputElement;
    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect(unlock).toBeDisabled();
    await user.type(box, "12ab3");
    expect(box.value).toBe("123");
    expect(unlock).toBeDisabled();
    await user.type(box, "4");
    await user.click(unlock);
    expect(await screen.findByRole("alert")).toHaveTextContent("That PIN didn't match — 4 attempts left");
    expect(box.value).toBe("");
    expect(onUnlocked).not.toHaveBeenCalled();
    await user.type(box, "2468{Enter}");                     // submit via the form
    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
  });

  it("describeVerify words every failure", () => {
    expect(describeVerify({ kind: "wrong", attemptsLeft: 1 })).toBe("That PIN didn't match — 1 attempt left");
    expect(describeVerify({ kind: "wrong", attemptsLeft: 0 })).toBe("That PIN didn't match");
    expect(describeVerify({ kind: "lockedOut", seconds: 60 })).toBe("Too many attempts — try again in 60s");
  });
});

describe("PitchForm — the pitch travels by mail", () => {
  it("builds a mailto to partners@ with the fields in subject and body", () => {
    const url = pitchMailto({ name: "Meera", company: "Studio X", email: "m@x.in", kind: "Creator", msg: "A premise" });
    expect(url.startsWith(`mailto:${PARTNERS_EMAIL}?subject=`)).toBe(true);
    const u = new URL(url);
    expect(u.searchParams.get("subject")).toBe("Pitch from Meera (Studio X) — Creator");
    expect(u.searchParams.get("body")).toBe("A premise\n\n—\nMeera\nStudio X\nm@x.in");
    expect(new URL(pitchMailto({ name: "M", company: "", email: "m@x.in", kind: "Creator", msg: "" })).searchParams.get("subject")).toBe("Pitch from M — Creator");
  });

  it("requires a name and a working email, then opens the mail app and toasts", async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    mockWallet = makeWallet({ toast });
    const assigned: string[] = [];
    const loc = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...loc, get href() { return loc.href; }, set href(v: string) { assigned.push(v); } },
    });
    render(<PitchForm />);
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/name and a working email/);
    await user.type(screen.getByLabelText("Your name"), "Meera");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(assigned).toHaveLength(0);
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "  meera@example.in ");
    await user.type(screen.getByLabelText("Company or channel"), "Studio X");
    await user.selectOptions(screen.getByLabelText("You are a"), "Brand or agency");
    await user.type(screen.getByLabelText("What do you have in mind?"), "A branded series");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(assigned).toHaveLength(1);
    const u = new URL(assigned[0]);
    expect(u.searchParams.get("subject")).toBe("Pitch from Meera (Studio X) — Brand or agency");
    expect(u.searchParams.get("body")).toContain("meera@example.in");
    expect(toast).toHaveBeenCalledWith(`Opening your mail app — or write to ${PARTNERS_EMAIL}`);
    Object.defineProperty(window, "location", { configurable: true, value: loc });
  });
});

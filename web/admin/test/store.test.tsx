import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StoreProvider, useStore, ME } from "../src/store";
import { MOCK_APPROVALS, MOCK_FLAGS } from "../src/api/mock";

// Force the api client's fallback so the effect loads the deterministic mocks.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return <StoreProvider>{children}</StoreProvider>;
}

async function mountStore() {
  const view = renderHook(() => useStore(), { wrapper });
  await waitFor(() => expect(view.result.current.approvals.length).toBe(MOCK_APPROVALS.length));
  return view;
}

describe("useStore guard", () => {
  it("throws when used outside the provider", () => {
    // Suppress React's error boundary console noise.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(/StoreProvider/);
    spy.mockRestore();
  });
});

function Consumer() {
  useStore();
  return null;
}

describe("store — initial load", () => {
  it("loads approvals, audit and flags from the api fallback", async () => {
    const { result } = await mountStore();
    expect(result.current.approvals).toHaveLength(MOCK_APPROVALS.length);
    expect(result.current.flags).toHaveLength(MOCK_FLAGS.length);
    expect(result.current.audit.length).toBeGreaterThan(0);
    expect(result.current.role).toBe("admin");
  });
});

describe("store — role preview", () => {
  it("setRole updates the role and shows a preview toast", async () => {
    const { result } = await mountStore();
    act(() => result.current.setRole("finance"));
    expect(result.current.role).toBe("finance");
    expect(result.current.toast).toBe("Previewing as Finance");
  });
});

describe("store — approvals routing", () => {
  it("addApproval prepends a new request to the inbox", async () => {
    const { result } = await mountStore();
    const before = result.current.approvals.length;
    act(() =>
      result.current.addApproval({
        id: "apr_new",
        kind: "Coin adjustment",
        detail: "Credit 1,300 coins",
        requestedBy: ME,
        when: "Just now",
        needs: "Finance or Admin",
        amount: 1300,
        userId: "usr_x",
      })
    );
    expect(result.current.approvals).toHaveLength(before + 1);
    expect(result.current.approvals[0].id).toBe("apr_new");
  });

  it("resolveApproval(approved) removes it and appends an approve audit row", async () => {
    const { result } = await mountStore();
    const target = result.current.approvals[0];
    const auditBefore = result.current.audit.length;
    act(() => result.current.resolveApproval(target.id, "approved", ME));
    expect(result.current.approvals.find((a) => a.id === target.id)).toBeUndefined();
    expect(result.current.audit).toHaveLength(auditBefore + 1);
    expect(result.current.audit[0].action).toBe("approval.approve");
    expect(result.current.audit[0].actor).toBe(ME);
    expect(result.current.audit[0].change).toContain(target.requestedBy);
  });

  it("resolveApproval(rejected) appends a reject audit row", async () => {
    const { result } = await mountStore();
    const target = result.current.approvals[0];
    act(() => result.current.resolveApproval(target.id, "rejected", ME));
    expect(result.current.audit[0].action).toBe("approval.reject");
  });

  it("resolveApproval with an unknown id writes no audit row", async () => {
    const { result } = await mountStore();
    const auditBefore = result.current.audit.length;
    const len = result.current.approvals.length;
    act(() => result.current.resolveApproval("does-not-exist", "approved", ME));
    expect(result.current.approvals).toHaveLength(len);
    expect(result.current.audit).toHaveLength(auditBefore);
  });
});

describe("store — audit append", () => {
  it("addAudit prepends a timestamped entry", async () => {
    const { result } = await mountStore();
    const before = result.current.audit.length;
    act(() =>
      result.current.addAudit({
        actor: ME,
        action: "wallet.adjust",
        entity: "usr_7b1e",
        change: "Credit 100",
      })
    );
    expect(result.current.audit).toHaveLength(before + 1);
    expect(result.current.audit[0].entity).toBe("usr_7b1e");
    expect(typeof result.current.audit[0].ts).toBe("number");
  });
});

describe("store — feature flags", () => {
  it("toggleFlag flips a flag and audits on->off and off->on", async () => {
    const { result } = await mountStore();
    const onFlag = result.current.flags.find((f) => f.enabled)!;
    act(() => result.current.toggleFlag(onFlag.key));
    expect(result.current.flags.find((f) => f.key === onFlag.key)!.enabled).toBe(false);
    expect(result.current.audit[0].action).toBe("flag.update");
    expect(result.current.audit[0].change).toBe("on → off");

    act(() => result.current.toggleFlag(onFlag.key));
    expect(result.current.flags.find((f) => f.key === onFlag.key)!.enabled).toBe(true);
    expect(result.current.audit[0].change).toBe("off → on");
  });

  it("toggleFlag ignores an unknown key", async () => {
    const { result } = await mountStore();
    const flagsBefore = result.current.flags.map((f) => f.enabled);
    const auditBefore = result.current.audit.length;
    act(() => result.current.toggleFlag("no.such.flag"));
    expect(result.current.flags.map((f) => f.enabled)).toEqual(flagsBefore);
    expect(result.current.audit).toHaveLength(auditBefore);
  });
});

describe("store — toast lifecycle", () => {
  it("clears the toast after the timeout", async () => {
    const { result } = await mountStore();
    vi.useFakeTimers();
    try {
      act(() => result.current.showToast("hello"));
      expect(result.current.toast).toBe("hello");
      act(() => vi.advanceTimersByTime(4200));
      expect(result.current.toast).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not clear a newer toast when an older timeout fires", async () => {
    const { result } = await mountStore();
    vi.useFakeTimers();
    try {
      act(() => result.current.showToast("first"));
      act(() => vi.advanceTimersByTime(2000));
      act(() => result.current.showToast("second"));
      act(() => vi.advanceTimersByTime(2200)); // fires the FIRST timeout
      expect(result.current.toast).toBe("second");
    } finally {
      vi.useRealTimers();
    }
  });
});

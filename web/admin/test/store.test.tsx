import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { StoreProvider, useStore } from "../src/store";
import { renderWithStore, getStore } from "./helpers";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

function Probe() {
  useStore();
  return null;
}

describe("useStore guard", () => {
  it("throws when used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/outside provider/);
    spy.mockRestore();
  });
});

describe("store — role preview", () => {
  it("setRole updates the role and shows an honest preview toast", async () => {
    renderWithStore(<div />);
    act(() => getStore().setRole("finance"));
    expect(getStore().role).toBe("finance");
    expect(getStore().toasts.at(-1)?.text).toMatch(/Previewing as Finance/);
    expect(getStore().toasts.at(-1)?.text).toMatch(/visual only/);
  });
});

describe("store — online state", () => {
  it("is offline when every fetch rejects", async () => {
    renderWithStore(<div />);
    await waitFor(() => expect(getStore().online).toBe(false));
  });
});

describe("store — approvals routing", () => {
  it("resolveApproval(approved) removes it and appends an approve audit row", async () => {
    renderWithStore(<div />);
    // identity resolves before the lists load (ADM-28), so let boot settle
    // before seeding — a late /audit answer would replace the local row
    await waitFor(() => expect(getStore().flags.length).toBeGreaterThan(0));
    act(() => getStore().addApproval({
      id: "apr_x", kind: "Coin adjustment", detail: "d", requestedBy: "sam",
      when: "now", needs: "Finance", amount: 900, userId: "u1",
    }));
    await act(async () => {
      await getStore().resolveApproval("apr_x", "approved", "riya");
    });
    expect(getStore().approvals.find((a) => a.id === "apr_x")).toBeUndefined();
    expect(getStore().audit[0].action).toBe("approval.approve");
  });

  it("resolveApproval(rejected) appends a reject audit row", async () => {
    renderWithStore(<div />);
    await waitFor(() => expect(getStore().flags.length).toBeGreaterThan(0));
    act(() => getStore().addApproval({
      id: "apr_y", kind: "Coin adjustment", detail: "d", requestedBy: "sam",
      when: "now", needs: "Finance", amount: 900, userId: "u1",
    }));
    await act(async () => {
      await getStore().resolveApproval("apr_y", "rejected", "riya", "no");
    });
    expect(getStore().audit[0].action).toBe("approval.reject");
  });

  it("resolveApproval with an unknown id writes no audit row", async () => {
    renderWithStore(<div />);
    await waitFor(() => expect(getStore().flags.length).toBeGreaterThan(0)); // initial loads settled
    const before = getStore().audit.length;
    await act(async () => {
      await getStore().resolveApproval("apr_ghost", "approved", "riya");
    });
    expect(getStore().audit.length).toBe(before);
  });
});

describe("store — audit append", () => {
  it("addAudit prepends a timestamped entry", () => {
    renderWithStore(<div />);
    act(() => getStore().addAudit({ actor: "riya", action: "x", entity: "e", change: "c" }));
    expect(getStore().audit[0].action).toBe("x");
    expect(typeof getStore().audit[0].ts).toBe("number");
  });
});

describe("store — feature flags", () => {
  it("toggleFlag flips a flag and audits on->off and off->on", async () => {
    renderWithStore(<div />);
    await waitFor(() => expect(getStore().flags.length).toBeGreaterThan(0));
    const key = getStore().flags[0].key;
    const initial = getStore().flags[0].enabled;
    await act(async () => {
      await getStore().toggleFlag(key);
    });
    expect(getStore().flags[0].enabled).toBe(!initial);
    expect(getStore().audit[0]).toMatchObject({ action: "flag.update", entity: key });
    await act(async () => {
      await getStore().toggleFlag(key);
    });
    expect(getStore().flags[0].enabled).toBe(initial);
  });

  it("toggleFlag ignores an unknown key", async () => {
    renderWithStore(<div />);
    await waitFor(() => expect(getStore().flags.length).toBeGreaterThan(0));
    const before = getStore().audit.length;
    await act(async () => {
      const res = await getStore().toggleFlag("not.a.flag");
      expect("error" in res && res.error).toBe("unknown flag");
    });
    expect(getStore().audit.length).toBe(before);
  });

  it("surfaces a server refusal instead of lying", async () => {
    renderWithStore(<div />);
    await waitFor(() => expect(getStore().flags.length).toBeGreaterThan(0));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 428,
      json: async () => ({ detail: "guarded flag: repeat the key" }),
    }));
    const key = getStore().flags[0].key;
    const initial = getStore().flags[0].enabled;
    await act(async () => {
      await getStore().toggleFlag(key);
    });
    expect(getStore().flags[0].enabled).toBe(initial);          // unchanged
    expect(getStore().toasts.at(-1)?.kind).toBe("error");
  });
});

describe("store — toast lifecycle", () => {
  it("clears a toast after its timeout and keeps newer ones", async () => {
    vi.useFakeTimers();
    try {
      render(
        <StoreProvider>
          <ProbeCapture />
        </StoreProvider>
      );
      act(() => captured!.showToast("first"));
      act(() => void vi.advanceTimersByTime(2000));
      act(() => captured!.showToast("second"));
      act(() => void vi.advanceTimersByTime(2500));             // first expires
      expect(captured!.toasts.map((t) => t.text)).toEqual(["second"]);
      act(() => void vi.advanceTimersByTime(2000));             // second expires
      expect(captured!.toasts).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

let captured: ReturnType<typeof useStore> | null = null;
function ProbeCapture() {
  captured = useStore();
  return null;
}

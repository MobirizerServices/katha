import { act, render, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import { StoreProvider, useStore } from "../src/store";

type Store = ReturnType<typeof useStore>;

let storeRef: Store | null = null;

function Capture() {
  storeRef = useStore();
  return null;
}

export function getStore(): Store {
  if (!storeRef) throw new Error("store not captured yet");
  return storeRef;
}

export function LocationDisplay() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

export function renderWithStore(
  ui: ReactNode,
  { route = "/" }: { route?: string } = {}
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider>
        <Capture />
        {ui}
      </StoreProvider>
    </MemoryRouter>
  );
}

// Render a bare element inside a router but WITHOUT the store provider, for
// components that do not consume the store.
export function renderInRouter(ui: ReactElement, { route = "/" } = {}) {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
}

// ---- fetch stub shared by the view tests -----------------------------------
// Routes are matched by substring IN INSERTION ORDER (put the more specific
// needle first). Anything unmatched rejects, i.e. the server is unreachable.
export type Stub = Record<string, (init?: RequestInit) => unknown>;

export function stubFetch(routes: Stub) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation(
    (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      for (const [needle, respond] of Object.entries(routes)) {
        if (String(url).includes(needle)) {
          const body = respond(init) as { __status?: number; detail?: string };
          const status = body.__status ?? 200;
          return Promise.resolve({
            ok: status < 400, status, headers: { get: () => null },
            json: async () => body,
          });
        }
      }
      return Promise.reject(new Error("offline"));
    }));
  return calls;
}

export const SIGNALS: Stub = {
  "/health/full": () => ({ status: "ok", checks: {}, at: "" }),
  "/auth/me": () => ({ mode: "headers", authenticated: true }),
  "/attention": () => ({ items: [] }),
  "/approvals": () => [],
  "/audit": () => ({ rows: [], chain_ok: true, total: 0 }),
  "/config/flags": () => [],
  "/metrics/ui": () => ({ ok: true }),
};

/** Flip the store online the way the app does: a successful signal read. */
export async function goOnline() {
  act(() => getStore().refreshSignals());
  await waitFor(() => expect(getStore().online).toBe(true));
}

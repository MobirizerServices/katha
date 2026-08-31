import { render } from "@testing-library/react";
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

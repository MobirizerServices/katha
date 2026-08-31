import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act } from "@testing-library/react";
import { Config } from "../src/views/Config";
import { renderWithStore, getStore } from "./helpers";
import { MOCK_FLAGS } from "../src/api/mock";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function renderConfig() {
  const view = renderWithStore(<Config />);
  await waitFor(() =>
    expect(screen.getByLabelText(`Toggle ${MOCK_FLAGS[0].key}`)).toBeInTheDocument()
  );
  return view;
}

describe("Config view", () => {
  it("renders all feature flags and the coin-pack SKUs with the web +10% bonus", async () => {
    await renderConfig();
    for (const f of MOCK_FLAGS) {
      expect(screen.getByLabelText(`Toggle ${f.key}`)).toBeInTheDocument();
    }
    // Coin packs — the web SKU shows the +10% bonus and 1,430 coins.
    expect(screen.getByText("coins_web_popular_in")).toBeInTheDocument();
    expect(screen.getByText("+10% web")).toBeInTheDocument();
    expect(screen.getByText("1,430")).toBeInTheDocument();
    expect(screen.getByText("coins_starter_in")).toBeInTheDocument();
  });

  it("admin can toggle a flag; aria-checked flips and it is audited", async () => {
    await renderConfig();
    const key = MOCK_FLAGS[0].key; // enabled: true
    const toggle = screen.getByLabelText(`Toggle ${key}`);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    expect(screen.getByLabelText(`Toggle ${key}`)).toHaveAttribute("aria-checked", "false");
    expect(getStore().audit[0]).toMatchObject({ action: "flag.update", entity: key });
  });

  it("non content/admin roles cannot toggle flags (control disabled)", async () => {
    await renderConfig();
    act(() => getStore().setRole("support"));
    const toggle = screen.getByLabelText(`Toggle ${MOCK_FLAGS[0].key}`);
    expect(toggle).toBeDisabled();
  });

  it("content ops can toggle flags (control enabled)", async () => {
    await renderConfig();
    act(() => getStore().setRole("content"));
    const toggle = screen.getByLabelText(`Toggle ${MOCK_FLAGS[0].key}`);
    expect(toggle).not.toBeDisabled();
  });
});

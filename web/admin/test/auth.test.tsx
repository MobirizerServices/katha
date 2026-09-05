import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import App from "../src/App";
import { Login, readAuthNote } from "../src/views/Login";
import { Access } from "../src/views/Access";
import { api, mutate } from "../src/api/client";
import { renderWithStore, getStore } from "./helpers";

type Stub = Record<string, () => unknown>;

/** URL-matched fetch stub; anything unmatched rejects like a dead network. */
function stubServer(routes: Stub) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation(
    (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      for (const [needle, respond] of Object.entries(routes)) {
        if (String(url).includes(needle)) {
          return Promise.resolve({ ok: true, json: async () => respond() });
        }
      }
      return Promise.reject(new Error("offline"));
    }));
  return calls;
}

const SIGNALS: Stub = {
  // the sidebar badge/Finance counter poll the inbox with every signal read
  "/approvals?": () => [],
  "/health/full": () => ({ status: "ok", checks: {}, at: "" }),
  "/attention": () => ({ items: [] }),
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  document.cookie = "katha_admin_auth_note=; max-age=0; path=/";
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("sign-in gate (#074)", () => {
  it("an unauthenticated OIDC deployment shows the Login screen, not the panel", async () => {
    stubServer({
      ...SIGNALS,
      "/auth/me": () => ({ mode: "oidc", authenticated: false, devIdp: true,
                           login: "/admin/v1/auth/login" }),
    });
    renderWithStore(<App />);
    const btn = await screen.findByText("Sign in · dev identity provider");
    expect(btn).toHaveAttribute("href", "/admin/v1/auth/login");
    expect(screen.getByText(/Dev IdP is active/)).toBeInTheDocument();
    expect(screen.queryByText("Katha Admin", { selector: ".side .brand" })).toBeNull();
  });

  it("says Google when a real issuer is configured", async () => {
    stubServer({
      ...SIGNALS,
      "/auth/me": () => ({ mode: "oidc", authenticated: false, devIdp: false,
                           login: "/admin/v1/auth/login" }),
    });
    renderWithStore(<App />);
    expect(await screen.findByText("Sign in with Google")).toBeInTheDocument();
  });

  it("explains a not-provisioned account from the callback cookie", async () => {
    document.cookie =
      "katha_admin_auth_note=" + encodeURIComponent("not_provisioned:new.hire@katha.dev");
    stubServer({
      ...SIGNALS,
      "/auth/me": () => ({ mode: "oidc", authenticated: false, devIdp: true }),
    });
    renderWithStore(<App />);
    const note = await screen.findByRole("alert");
    expect(note.textContent).toContain("new.hire@katha.dev");
    expect(note.textContent).toContain("isn't provisioned");
  });

  it("surfaces a flow error from the cookie and clears it after reading", () => {
    document.cookie =
      "katha_admin_auth_note=" + encodeURIComponent("error:state mismatch");
    renderWithStore(<Login />);
    expect(screen.getByRole("alert").textContent).toContain("state mismatch");
    expect(document.cookie).not.toContain("katha_admin_auth_note=e");
  });

  it("readAuthNote parses, clears, and ignores absence", () => {
    document.cookie = "katha_admin_auth_note=" + encodeURIComponent("error:x");
    expect(readAuthNote()).toEqual({ kind: "error", detail: "x" });
    expect(readAuthNote()).toBeNull(); // cleared by the first read
    document.cookie = "katha_admin_auth_note=plainkind";
    expect(readAuthNote()).toEqual({ kind: "plainkind", detail: "" });
  });

  it("headers-mode deployments never see the gate", async () => {
    stubServer({
      ...SIGNALS,
      "/auth/me": () => ({ mode: "headers", authenticated: true,
                           email: "riya", role: "admin" }),
    });
    renderWithStore(<App />, { route: "/access" });
    await waitFor(() => expect(screen.getByText("Permission matrix")).toBeInTheDocument());
    expect(screen.getByLabelText("Preview as role")).toBeInTheDocument();
  });
});

describe("signed-in OIDC operator", () => {
  const ME: Stub = {
    ...SIGNALS,
    "/auth/me": () => ({ mode: "oidc", authenticated: true, devIdp: true,
                         email: "sam@katha.dev", name: "Sam", role: "support" }),
  };

  it("sidebar shows the real identity, locks the role, and offers sign out", async () => {
    stubServer({ ...ME, "/grievances": () => ({ grievances: [] }) });
    renderWithStore(<App />, { route: "/grievances" });
    await waitFor(() => expect(screen.getByText("Sam")).toBeInTheDocument());
    // server said support → the store follows; no preview switcher
    expect(getStore().role).toBe("support");
    expect(screen.queryByLabelText("Preview as role")).toBeNull();
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  it("sign out clears the session and returns to the Login screen", async () => {
    let authed = true;
    stubServer({
      ...SIGNALS,
      "/auth/logout": () => { authed = false; return { ok: true }; },
      "/auth/me": () => ({ mode: "oidc", authenticated: authed, devIdp: true,
                           email: "sam@katha.dev", name: "Sam", role: "admin" }),
    });
    renderWithStore(<App />, { route: "/access" });
    await waitFor(() => expect(screen.getByText("Sign out")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Sign out"));
    await screen.findByText("Sign in · dev identity provider");
    expect(screen.getByText("Signed out")).toBeInTheDocument();
  });

  it("offline sign-out is refused honestly", async () => {
    stubServer({
      ...SIGNALS,
      "/auth/me": () => ({ mode: "oidc", authenticated: true, devIdp: true,
                           email: "sam@katha.dev", role: "admin" }),
    });
    renderWithStore(<App />, { route: "/access" });
    await waitFor(() => expect(screen.getByText("Sign out")).toBeInTheDocument());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    fireEvent.click(screen.getByText("Sign out"));
    await screen.findByText(/could not reach the server to sign out/);
    expect(screen.getByText("Sign out")).toBeInTheDocument(); // still signed in
  });
});

describe("provisioned operators (Access · People)", () => {
  const DIRECTORY = { users: [
    { email: "ops@katha.dev", role: "admin", by: "bootstrap", at: "t" },
    { email: "riya@katha.dev", role: "support", by: "ops@katha.dev", at: "t" },
  ] };

  function renderPeople(calls?: { url: string; init?: RequestInit }[]) {
    const c = calls ?? stubServer({
      ...SIGNALS,
      "/auth/me": () => ({ mode: "oidc", authenticated: true, devIdp: true,
                           email: "ops@katha.dev", role: "admin" }),
      "/access/users": () => DIRECTORY,
      "/access/matrix": () => null,
    });
    renderWithStore(<Access />);
    return c;
  }

  async function online() {
    getStore().refreshSignals();
    await waitFor(() => expect(getStore().online).toBe(true));
  }

  it("lists the directory and blocks self-revocation", async () => {
    renderPeople();
    await screen.findByText("riya@katha.dev");
    await online();
    const mine = screen.getAllByText("ops@katha.dev")[0].closest("tr")!;
    expect(within(mine).getByText("Revoke")).toBeDisabled();
    const theirs = screen.getByText("riya@katha.dev").closest("tr")!;
    expect(within(theirs).getByText("Revoke")).toBeEnabled();
  });

  it("grants a non-admin role directly and reports the result", async () => {
    const calls = stubServer({
      ...SIGNALS,
      "/auth/me": () => ({ mode: "oidc", authenticated: true, devIdp: true,
                           email: "ops@katha.dev", role: "admin" }),
      "/access/users/new%40katha.dev": () => ({ email: "new@katha.dev", role: "qc" }),
      "/access/users": () => DIRECTORY,
      "/access/matrix": () => null,
    });
    renderPeople(calls);
    await screen.findByText("riya@katha.dev");
    await online();
    fireEvent.change(screen.getByLabelText("Email to provision"),
                     { target: { value: "new@katha.dev" } });
    fireEvent.change(screen.getByLabelText("Role to grant"), { target: { value: "qc" } });
    fireEvent.click(screen.getByText("Grant access"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text.includes("new@katha.dev can now sign in"))).toBe(true));
    const put = calls.find((c) => c.init?.method === "PUT");
    expect(put?.url).toContain("/access/users/new%40katha.dev");
    expect(JSON.parse(String(put?.init?.body))).toMatchObject({ role: "qc" });
    expect(screen.getByLabelText("Email to provision")).toHaveValue("");
  });

  it("granting admin demands the typed email and sends the confirm", async () => {
    const calls = stubServer({
      ...SIGNALS,
      "/auth/me": () => ({ mode: "oidc", authenticated: true, devIdp: true,
                           email: "ops@katha.dev", role: "admin" }),
      "/access/users/lead%40katha.dev": () => ({ email: "lead@katha.dev", role: "admin" }),
      "/access/users": () => DIRECTORY,
      "/access/matrix": () => null,
    });
    renderPeople(calls);
    await screen.findByText("riya@katha.dev");
    await online();
    fireEvent.change(screen.getByLabelText("Email to provision"),
                     { target: { value: "lead@katha.dev" } });
    fireEvent.change(screen.getByLabelText("Role to grant"), { target: { value: "admin" } });
    fireEvent.click(screen.getByText("Grant access"));
    const modal = await screen.findByRole("dialog");
    const go = within(modal).getByText("Grant admin");
    expect(go).toBeDisabled();
    fireEvent.change(within(modal).getByLabelText("Confirm email"),
                     { target: { value: "lead@katha.dev" } });
    fireEvent.click(go);
    await waitFor(() => {
      const put = calls.find((c) => c.init?.method === "PUT");
      expect(JSON.parse(String(put?.init?.body)))
        .toMatchObject({ role: "admin", confirm: "lead@katha.dev" });
    });
  });

  it("revokes and reloads; server errors surface", async () => {
    let revoked = false;
    stubServer({
      ...SIGNALS,
      "/auth/me": () => ({ mode: "oidc", authenticated: true, devIdp: true,
                           email: "ops@katha.dev", role: "admin" }),
      "/access/users/riya%40katha.dev": () => ({ email: "riya@katha.dev", role: null }),
      "/access/users": () => {
        return revoked
          ? { users: DIRECTORY.users.slice(0, 1) }
          : ((revoked = true), DIRECTORY);
      },
      "/access/matrix": () => null,
    });
    renderWithStore(<Access />);
    await screen.findByText("riya@katha.dev");
    await online();
    const row = screen.getByText("riya@katha.dev").closest("tr")!;
    fireEvent.click(within(row).getByText("Revoke"));
    await waitFor(() => expect(getStore().toasts.some((t) =>
      t.text.includes("riya@katha.dev can no longer sign in"))).toBe(true));
    await waitFor(() =>
      expect(screen.queryByText("riya@katha.dev")).toBeNull());
  });

  it("is hidden from non-admin roles entirely", async () => {
    stubServer({
      ...SIGNALS,
      "/auth/me": () => ({ mode: "oidc", authenticated: true, devIdp: true,
                           email: "sam@katha.dev", role: "support" }),
      "/access/matrix": () => null,
    });
    renderWithStore(<Access />);
    await waitFor(() => expect(getStore().role).toBe("support"));
    expect(screen.queryByText("Provisioned operators")).toBeNull();
  });
});

describe("client auth surface", () => {
  it("authMe hits /auth/me and null means unreachable", async () => {
    const calls = stubServer({ "/auth/me": () => ({ mode: "headers", authenticated: false }) });
    const me = await api.authMe();
    expect(me?.mode).toBe("headers");
    expect(calls[0].url).toContain("/admin/v1/auth/me");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await api.authMe()).toBeNull();
  });

  it("every mutation carries the CSRF header", async () => {
    const calls = stubServer({ "/auth/logout": () => ({ ok: true }) });
    await mutate.logout();
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["X-Katha-CSRF"]).toBe("1");
  });

  it("grant/revoke use the directory endpoints", async () => {
    const calls = stubServer({ "/access/users/a%40b.dev": () => ({}) });
    await mutate.grantAccess("a@b.dev", "support");
    await mutate.revokeAccess("a@b.dev");
    expect(calls[0].init?.method).toBe("PUT");
    expect(calls[1].init?.method).toBe("DELETE");
  });
});

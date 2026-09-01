// Live client for Katha core-api. The web app renders server state and captures
// intent; the backend ledger is the source of truth (all money flows through it).
const BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8799";
const TOKEN_KEY = "katha.token.v1";

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(t: string) {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
}
export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

async function call<T>(path: string, opts: RequestInit = {}, auth = true): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as any) };
  const tok = getToken();
  if (auth && tok) headers["Authorization"] = `Bearer ${tok}`;
  const r = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!r.ok) {
    const body = await r.text();
    throw new ApiError(r.status, body);
  }
  return (await r.json()) as T;
}

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`api ${status}: ${body}`);
  }
}

export interface WalletDTO { balance_bought: number; balance_bonus: number; total: number; }

export const api = {
  base: BASE,

  async guestLogin(): Promise<string> {
    const r = await call<{ access_token: string }>("/v1/auth/guest", { method: "POST", body: "{}" }, false);
    setToken(r.access_token);
    return r.access_token;
  },

  async otpLogin(phone: string, code = "1234"): Promise<string> {
    await call("/v1/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) }, false);
    const r = await call<{ access_token: string }>(
      "/v1/auth/otp/verify",
      { method: "POST", body: JSON.stringify({ phone, code }) },
      false
    );
    setToken(r.access_token);
    return r.access_token;
  },

  wallet(): Promise<WalletDTO> {
    return call<WalletDTO>("/v1/wallet");
  },

  // Web coin purchase — credits the pack + the +10% web bonus in the real ledger.
  webOrder(sku: string, email = ""): Promise<WalletDTO> {
    return call<WalletDTO>("/v1/web/orders", {
      method: "POST", body: JSON.stringify({ sku, email }),
    });
  },

  unlockEpisode(slug: string, n: number, key: string): Promise<{ wallet: WalletDTO; spent_bonus: number; spent_bought: number }> {
    return call(`/v1/series/${slug}/episodes/${n}/unlock`, {
      method: "POST", body: JSON.stringify({ idempotency_key: key }),
    });
  },

  unlockAll(slug: string, key: string): Promise<{ wallet: WalletDTO; episode_ids: string[] }> {
    return call(`/v1/series/${slug}/unlock-all`, {
      method: "POST", body: JSON.stringify({ idempotency_key: key }),
    });
  },

  // Authoritative access check: server returns {locked:true,...} or the signed playback payload.
  playback(slug: string, n: number): Promise<any> {
    return call(`/v1/series/${slug}/episodes/${n}/playback`, { method: "POST", body: "{}" });
  },
};

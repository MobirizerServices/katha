// Live client for Katha core-api. The web app renders server state and captures
// intent; the backend ledger is the source of truth (all money flows through it).
// Nothing here computes a price, a bonus, a balance or an entitlement.
// Production: same origin — the edge serves /v1 and /media on the site host, so
// nothing is baked into the bundle. Dev/test: the local core-api.
const BASE = process.env.NEXT_PUBLIC_API_BASE
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:8799");
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

export interface ProfileDTO {
  user_id: string;
  kind: "guest" | "phone" | "apple";
  display_name: string;
  language: string;
  phone: string | null;
}

/** A coin pack as the server sells it. `web_bonus_coins` is what a WEB
 * purchase additionally credits — rendered, never recomputed here. */
export interface PackDTO {
  sku: string;
  storefront: string;
  price_minor: number;
  currency: string;
  coins: number;
  bonus_coins: number;
  web_bonus_coins: number;
}

/** Remote pricing facts the clients render (from /v1/config). */
export interface ConfigDTO {
  free_episode_count: number;
  episode_coin_price: number;
  bundle_discount_pct: number;
  coin_rupee_rate: number;
}

/** The server's access decision for one episode: either a playable stream or
 * the paywall, with every number the paywall shows. */
export type PlaybackDTO =
  | { locked: false; episode_id: string; free: boolean; hls_master_url: string }
  | {
      locked: true;
      episode_id: string;
      price_coins: number;
      balance: number;
      remaining_locked: number;
      bundle_offer_coins: number;
    };

export interface UnlockDTO { wallet: WalletDTO; spent_bonus: number; spent_bought: number; episode_ids: string[] }

export const api = {
  base: BASE,

  async guestLogin(): Promise<string> {
    const r = await call<{ access_token: string }>("/v1/auth/guest", { method: "POST", body: "{}" }, false);
    setToken(r.access_token);
    return r.access_token;
  },

  /** Request a code for `phone` (the server texts it; dev stubs accept any). */
  otpRequest(phone: string): Promise<unknown> {
    return call("/v1/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) }, false);
  },

  /** Verify the code the viewer typed. Sent WITH the current (guest) bearer:
   * the server folds that guest's coins, unlocks and progress into the member
   * account on sign-in. A wrong code is a 401 — surfaced, never swallowed. */
  async otpLogin(phone: string, code: string): Promise<string> {
    const r = await call<{ access_token: string }>(
      "/v1/auth/otp/verify",
      { method: "POST", body: JSON.stringify({ phone, code }) }
    );
    setToken(r.access_token);
    return r.access_token;
  },

  me(): Promise<ProfileDTO> {
    return call<ProfileDTO>("/v1/me");
  },

  wallet(): Promise<WalletDTO> {
    return call<WalletDTO>("/v1/wallet");
  },

  /** The packs the web store sells, with the server's web bonus on each. */
  packs(): Promise<PackDTO[]> {
    return call<PackDTO[]>("/v1/iap/packs?storefront=IN", {}, false);
  },

  config(): Promise<ConfigDTO> {
    return call<ConfigDTO>("/v1/config", {}, false);
  },

  // Web coin purchase — credits the pack + the web bonus in the real ledger.
  // orderRef is the payment id (the PSP's, in production): it keys the credit's
  // idempotency, so buying the same pack twice is two payments, not a dedupe.
  webOrder(sku: string, email = "", orderRef?: string): Promise<WalletDTO> {
    return call<WalletDTO>("/v1/web/orders", {
      method: "POST",
      body: JSON.stringify({ sku, email, ...(orderRef ? { order_ref: orderRef } : {}) }),
    });
  },

  unlockEpisode(slug: string, n: number, key: string): Promise<UnlockDTO> {
    return call(`/v1/series/${slug}/episodes/${n}/unlock`, {
      method: "POST", body: JSON.stringify({ idempotency_key: key }),
    });
  },

  unlockAll(slug: string, key: string): Promise<UnlockDTO> {
    return call(`/v1/series/${slug}/unlock-all`, {
      method: "POST", body: JSON.stringify({ idempotency_key: key }),
    });
  },

  // Authoritative access check: {locked:true,...} with the paywall numbers, or
  // the signed playback payload.
  playback(slug: string, n: number): Promise<PlaybackDTO> {
    return call(`/v1/series/${slug}/episodes/${n}/playback`, { method: "POST", body: "{}" });
  },
};

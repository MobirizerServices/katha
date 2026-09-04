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
  language: string;      // content language: hi | ta | te
  ui_language?: string;  // app chrome language: en | hi
  phone: string | null;
}

/** A series as the catalog endpoints summarise it (search, my list). */
export interface SeriesSummaryDTO {
  slug: string;
  title: string;
  genres: string[];
  episode_count: number;
  primary_language: string;
  content_rating: string;
  cover_url: string;
  cover_wide_url: string;
}

export interface SearchPersonDTO { name: string; role: string; series: SeriesSummaryDTO[] }
export interface SearchDTO { query: string; series: SeriesSummaryDTO[]; people: SearchPersonDTO[] }
export interface MyListDTO { slugs: string[]; series: SeriesSummaryDTO[] }
export interface RemindersDTO { slugs: string[] }

/** A subtitle file the server serves under the same stream token as the HLS tree. */
export interface CaptionDTO { lang: string; label: string; url: string }
export interface AudioDTO { lang: string; label: string; kind: string }

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
  | {
      locked: false;
      episode_id: string;
      free: boolean;
      hls_master_url: string;
      captions?: CaptionDTO[];
      audio?: AudioDTO[];
    }
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

  /** Change profile facts (content language etc.); the server echoes the profile. */
  updateMe(patch: Partial<Pick<ProfileDTO, "display_name" | "language" | "ui_language">>): Promise<ProfileDTO> {
    return call<ProfileDTO>("/v1/me", { method: "PATCH", body: JSON.stringify(patch) });
  },

  /** Sign out every OTHER device: the server bumps the token version and hands
   * this browser a fresh token, which replaces the stored one. */
  async signOutDevices(): Promise<ProfileDTO> {
    const r = await call<{ access_token: string; user: ProfileDTO }>("/v1/me/signout-devices", { method: "POST", body: "{}" });
    setToken(r.access_token);
    return r.user;
  },

  /** Account deletion (DPDP): the server scrubs PII and kills every token. */
  deleteMe(): Promise<unknown> {
    return call("/v1/me", { method: "DELETE" });
  },

  // ---- catalog + engagement ---------------------------------------------
  /** Catalog search; no auth. `lang` narrows to one content language. */
  search(q: string, lang?: string): Promise<SearchDTO> {
    const qs = new URLSearchParams({ q });
    if (lang) qs.set("lang", lang);
    return call<SearchDTO>(`/v1/search?${qs}`, {}, false);
  },

  myList(): Promise<MyListDTO> {
    return call<MyListDTO>("/v1/me/list");
  },
  addToList(slug: string): Promise<MyListDTO> {
    return call<MyListDTO>(`/v1/me/list/${slug}`, { method: "PUT" });
  },
  removeFromList(slug: string): Promise<MyListDTO> {
    return call<MyListDTO>(`/v1/me/list/${slug}`, { method: "DELETE" });
  },

  reminders(): Promise<RemindersDTO> {
    return call<RemindersDTO>("/v1/me/reminders");
  },
  addReminder(slug: string): Promise<RemindersDTO> {
    return call<RemindersDTO>(`/v1/me/reminders/${slug}`, { method: "PUT" });
  },
  removeReminder(slug: string): Promise<RemindersDTO> {
    return call<RemindersDTO>(`/v1/me/reminders/${slug}`, { method: "DELETE" });
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

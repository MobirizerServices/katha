// admin-api client. Base URL is /admin/v1 (env-overridable, #109). Reads fall
// back to the static mock when the server is unreachable so the app stays
// browsable offline — and the store surfaces that state as a banner (#005)
// instead of letting fixture data pass for truth.
import type {
  AdminUser,
  Approval,
  AuditEntry,
  FeatureFlag,
  Overview,
  Series,
  UserLedger,
} from "./types";
import {
  MOCK_APPROVALS,
  MOCK_AUDIT,
  MOCK_FLAGS,
  MOCK_OVERVIEW,
  MOCK_SERIES,
  MOCK_USERS,
} from "./mock";

export const BASE_URL =
  (import.meta as { env?: Record<string, string> }).env?.VITE_ADMIN_API_BASE || "/admin/v1";

// ---- online/offline seam (#005) -------------------------------------------
let online = false;
const listeners = new Set<(v: boolean) => void>();

export function isOnline(): boolean {
  return online;
}
export function onOnlineChange(fn: (v: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setOnline(v: boolean) {
  if (v !== online) {
    online = v;
    listeners.forEach((fn) => fn(v));
  }
}

// X-Actor-Id/X-Role only matter in dev "headers" auth; with OIDC sessions the
// server ignores them and the CSRF header authorizes cookie-borne mutations.
const HEADERS = {
  accept: "application/json",
  "X-Actor-Id": "riya",
  "X-Role": "admin",
  "X-Katha-CSRF": "1",
};

// Tiny TTL cache (#103): hot lists (series, flags, policy, matrix) skip a
// round-trip for 30s. Mutating views call the API directly; money reads and
// health signals are never cached.
const CACHE = new Map<string, { t: number; v: unknown }>();
const CACHE_TTL_MS = 30_000;

export function __resetApiCache(): void {
  CACHE.clear();
}

async function get<T>(path: string, fallback: T, ttl = 0): Promise<T> {
  if (ttl > 0) {
    const hit = CACHE.get(path);
    if (hit && Date.now() - hit.t < ttl) return hit.v as T;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${BASE_URL}${path}`, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setOnline(true);
    const parsed = (await res.json()) as T;
    if (ttl > 0) CACHE.set(path, { t: Date.now(), v: parsed });
    return parsed;
  } catch {
    setOnline(false);
    return fallback;
  }
}

export interface Page<T> {
  users?: T[];
  total: number;
}

export interface AuditPage {
  rows: AuditEntry[];
  chain_ok: boolean;
  total: number;
}

export interface Health {
  status: "ok" | "degraded" | "down";
  checks: Record<string, string>;
  at: string;
}

export interface AttentionItem {
  id: string;
  severity: "danger" | "warn" | "info";
  title: string;
  detail: string;
  to: string;
  ack?: { by: string; at: string };
}

export interface Grievance {
  id: string;
  user_id: string;
  contact: string;
  channel: string;
  subject: string;
  body: string;
  status: "new" | "ack" | "resolved";
  assignee: string;
  created_at: string;
  ack_at: string;
  resolved_at: string;
  notes: { by: string; at?: string; note: string }[];
  age_hours: number;
  ack_breach: boolean;
  resolve_breach: boolean;
}

export interface SeriesDetail {
  slug: string;
  title: string;
  synopsis: string;
  genres: string[];
  language: string;
  episodeCount: number;
  freeEpisodes: number;
  coinPrice: number;
  bundleDiscountPct: number;
  status: string;
  rating: string;
  ratingHistory: { value?: string; by?: string; at?: string; reason?: string };
  updatedAt: string;
  coverUrl: string;
  media: { covers_ok: boolean; episodes_with_media: number; episodes_missing: number };
  episodes: { number: number; title: string; isFree: boolean; hasMedia?: boolean }[];
  previewWeb: string;
  pricingOverridden?: boolean;
  rights?: { owner: string; license_until: string };
}

/** Who is signed in, and how auth works on this deployment (#074). */
export interface Identity {
  mode: "headers" | "oidc";
  authenticated: boolean;
  email?: string;
  name?: string;
  role?: string;
  devIdp?: boolean;
  login?: string;
  reason?: string;
}

export interface AccessUser {
  email: string;
  role: string;
  by?: string;
  at?: string;
}

export interface AnalyticsWindow {
  coins_purchased: number;
  revenue_rupees: number;
  coins_iap: number;
  coins_web: number;
  unlocks: number;
  dau_peak: number;
  new_users: number;
  watch_minutes: number;
  coins_refunded: number;
  refund_ratio_pct: number;
}

export interface Analytics {
  windows: Record<"today" | "7d" | "30d",
                  { current: AnalyticsWindow; previous: AnalyticsWindow }>;
  funnel: Record<"1d" | "7d" | "30d",
                 { paywall_view: number; purchase: number; unlock: number }>;
  days: string[];
  spark: Record<string, number[]>;
  outstanding_trend: number[];
  outstanding_rupees: number;
  breakage_dormant_coins: number;
  coin_rupee_rate: number;
  generated_at: string;
}

export interface Experiment {
  key: string;
  hypothesis: string;
  variants: { name: string; pct: number }[];
  status: "draft" | "running" | "stopped";
  by?: string;
  at?: string;
}

export interface Policy {
  dual_approval_threshold: number;
  coin_rupee_rate: number;
  pricing: { free_episode_count: number; episode_coin_price: number; bundle_discount_pct: number };
  min_app_version: string;
}

export const api = {
  async getOverview(): Promise<Overview> {
    return get<Overview>("/overview", MOCK_OVERVIEW);
  },
  async listSeries(): Promise<Series[]> {
    return get<Series[]>("/catalog/series", MOCK_SERIES, CACHE_TTL_MS);
  },
  async seriesDetail(slug: string): Promise<SeriesDetail | null> {
    return get<SeriesDetail | null>(`/catalog/series/${slug}`, null);
  },
  async listUsers(opts: { q?: string; offset?: number; limit?: number; sort?: string;
                          segment?: string } = {}):
      Promise<{ users: AdminUser[]; total: number }> {
    const p = new URLSearchParams();
    if (opts.q) p.set("q", opts.q);
    if (opts.offset) p.set("offset", String(opts.offset));
    p.set("limit", String(opts.limit ?? 50));
    if (opts.sort) p.set("sort", opts.sort);
    if (opts.segment) p.set("segment", opts.segment);
    // Offline parity: the sample directory honors the query/segment too.
    const needle = (opts.q ?? "").toLowerCase();
    const fallback = MOCK_USERS.filter((u) =>
      (!needle || u.id.toLowerCase().includes(needle) ||
        u.phone.toLowerCase().includes(needle) ||
        u.name.toLowerCase().includes(needle)) &&
      (opts.segment !== "guests" || u.payer === "—") &&
      (opts.segment !== "payers" || u.payer !== "—"));
    return get<{ users: AdminUser[]; total: number }>(
      `/users?${p}`, { users: fallback, total: fallback.length });
  },
  async listApprovals(status = "pending"): Promise<Approval[]> {
    return get<Approval[]>(`/approvals?status=${status}`, MOCK_APPROVALS);
  },
  async listFlags(): Promise<FeatureFlag[]> {
    return get<FeatureFlag[]>("/config/flags", MOCK_FLAGS, CACHE_TTL_MS);
  },
  async listAudit(opts: { actor?: string; q?: string; limit?: number; before?: number } = {}):
      Promise<AuditPage> {
    const p = new URLSearchParams();
    if (opts.actor) p.set("actor", opts.actor);
    if (opts.q) p.set("q", opts.q);
    p.set("limit", String(opts.limit ?? 100));
    if (opts.before) p.set("before", String(opts.before));
    const n = (opts.q ?? "").toLowerCase();
    const rows = MOCK_AUDIT.filter((r) =>
      (!opts.actor || r.actor === opts.actor) &&
      (!n || r.action.toLowerCase().includes(n) || r.entity.toLowerCase().includes(n) ||
        r.change.toLowerCase().includes(n)));
    return get<AuditPage>(`/audit?${p}`,
      { rows, chain_ok: true, total: rows.length });
  },
  async getUserLedger(userId: string): Promise<UserLedger> {
    return get<UserLedger>(`/users/${userId}/ledger`, {
      user_id: userId,
      wallet: { balance_bought: 0, balance_bonus: 0, total: 0 },
      transactions: [],
    });
  },
  async getEntitlements(userId: string):
      Promise<{ entitlements: { episode_id: string; source: string; created_at: string }[] }> {
    return get(`/users/${userId}/entitlements`, { entitlements: [] });
  },
  async getTimeline(userId: string):
      Promise<{ events: { ts: string; kind: string; type: string; detail: string; net: number }[] }> {
    return get(`/users/${userId}/timeline`, { events: [] });
  },
  async exportUser(userId: string): Promise<Record<string, unknown> | null> {
    return get<Record<string, unknown> | null>(`/users/${userId}/export`, null);
  },
  async policy(): Promise<Policy> {
    return get<Policy>("/config/policy", {
      dual_approval_threshold: 500, coin_rupee_rate: 0.15,
      pricing: { free_episode_count: 10, episode_coin_price: 30, bundle_discount_pct: 25 },
      min_app_version: "1.0.0",
    });
  },
  async packs(): Promise<{ sku: string; storefront: string; price_minor: number;
                           currency: string; coins: number; bonus: number }[]> {
    return get("/config/packs", []);
  },
  async health(): Promise<Health | null> {
    return get<Health | null>("/health/full", null);
  },
  async attention(): Promise<{ items: AttentionItem[] }> {
    return get("/attention", { items: [] });
  },
  async matrix(): Promise<{ matrix: { capability: string; roles: string[];
                                      notes?: Record<string, string> }[]; roles: string[] } | null> {
    return get("/access/matrix", null);
  },
  async grievances(): Promise<{ grievances: Grievance[] }> {
    return get("/grievances", { grievances: [] });
  },
  /** null only when the server is unreachable — a real answer always has mode. */
  async authMe(): Promise<Identity | null> {
    return get<Identity | null>("/auth/me", null);
  },
  async listAccessUsers(): Promise<{ users: AccessUser[] } | null> {
    return get<{ users: AccessUser[] } | null>("/access/users", null);
  },
  async analytics(): Promise<Analytics | null> {
    return get<Analytics | null>("/analytics", null);
  },
  async listExperiments(): Promise<{ experiments: Experiment[] }> {
    return get("/experiments", { experiments: [] });
  },
  async listDevices(userId: string):
      Promise<{ devices: { ua: string; ip: string; first_seen: string;
                           last_seen: string }[] }> {
    return get(`/users/${userId}/devices`, { devices: [] });
  },
};

/** Mutations. Every call resolves to the parsed body, or `{ offline: true }`
 *  when the server is absent — callers reconcile against the SERVER's answer
 *  (#026/#063), never assume success. */
export type MutationResult =
  | ({ offline?: false; error?: string } & Record<string, unknown>)
  | { offline: true };

export async function send(path: string, method: string, body?: unknown): Promise<MutationResult> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "content-type": "application/json", ...HEADERS },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    setOnline(true);
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { error: String(parsed.detail ?? `HTTP ${res.status}`) };
    return parsed;
  } catch {
    setOnline(false);
    return { offline: true };
  }
}

export const mutate = {
  adjust: (userId: string, coins: number, reasonCode: string, note: string) =>
    send("/wallet/adjust", "POST", { user_id: userId, coins, reason_code: reasonCode, note }),
  refund: (userId: string, txId: string) =>
    send("/wallet/refund", "POST", { user_id: userId, tx_id: txId }),
  erase: (userId: string) => send(`/users/${userId}/erase`, "POST"),
  approve: (id: string) => send(`/approvals/${id}/approve`, "POST"),
  reject: (id: string, note = "") => send(`/approvals/${id}/reject`, "POST", { note }),
  setFlag: (key: string, enabled: boolean, pct = 100, confirm?: string) =>
    send(`/config/flags/${key}`, "PATCH", { enabled, pct, confirm }),
  setStatus: (slug: string, status: string, reason = "") =>
    send(`/catalog/series/${slug}/status`, "POST", { status, reason }),
  setRating: (slug: string, rating: string, reason: string) =>
    send(`/catalog/series/${slug}/rating`, "PATCH", { rating, reason }),
  setPack: (sku: string, fields: Record<string, number>) =>
    send(`/config/packs/${sku}`, "PATCH", { ...fields, confirm: sku }),
  setMinVersion: (value: string) =>
    send("/config/values/app.min_version", "PATCH", { value }),
  grievanceAck: (id: string) => send(`/grievances/${id}/ack`, "POST"),
  grievanceResolve: (id: string, note: string) =>
    send(`/grievances/${id}/resolve`, "POST", { note }),
  logout: () => send("/auth/logout", "POST"),
  grantAccess: (email: string, role: string, confirm?: string) =>
    send(`/access/users/${encodeURIComponent(email)}`, "PUT", { role, confirm }),
  revokeAccess: (email: string) =>
    send(`/access/users/${encodeURIComponent(email)}`, "DELETE"),
  ackAttention: (id: string) =>
    send(`/attention/${encodeURIComponent(id)}/ack`, "POST"),
  createSeries: (body: Record<string, unknown>) =>
    send("/catalog/series", "POST", body),
  setPricing: (slug: string, fields: { coin_price?: number; free_episodes?: number }) =>
    send(`/catalog/series/${slug}/pricing`, "PATCH", { ...fields, confirm: slug }),
  setEpisodeTitle: (slug: string, number: number, title: string) =>
    send(`/catalog/series/${slug}/episodes/${number}`, "PATCH", { title }),
  setRights: (slug: string, owner: string, licenseUntil: string) =>
    send(`/catalog/series/${slug}/rights`, "PATCH",
         { owner, license_until: licenseUntil }),
  setExperiment: (key: string, body: Record<string, unknown>) =>
    send(`/experiments/${key}`, "PUT", body),
  signoutDevices: (userId: string) =>
    send(`/users/${userId}/signout-devices`, "POST"),
  uiPing: (view: string) => send("/metrics/ui", "POST", { view }),
};

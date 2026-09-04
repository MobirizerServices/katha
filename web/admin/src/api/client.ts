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

export const BASE_URL = import.meta.env.VITE_ADMIN_API_BASE || "/admin/v1";
/** Where covers are served from (core-api / the CDN). Dev: the local core-api;
 *  QA/prod: the public app origin (set VITE_MEDIA_BASE at build). */
export const MEDIA_BASE = import.meta.env.VITE_MEDIA_BASE || "http://127.0.0.1:8799";

// ---- online/offline seam (#005) -------------------------------------------
let online = false;
const listeners = new Set<(v: boolean) => void>();
// 401/403 from the server means the SESSION is gone (or the role changed),
// not that the server is: the store re-reads identity and routes to Login.
const unauthListeners = new Set<(status: number) => void>();

export function onUnauthorized(fn: (status: number) => void): () => void {
  unauthListeners.add(fn);
  return () => unauthListeners.delete(fn);
}
function notifyUnauthorized(status: number) {
  if (status === 401 || status === 403) unauthListeners.forEach((fn) => fn(status));
}

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

/** Read `path`. `offline` is returned ONLY when the server cannot be reached
 *  (sample fixtures, flagged by the banner); an HTTP error from a reachable
 *  server returns `onError` (an empty shape) — fixture data must never stand
 *  in for a 401 after the session expires or a 500 from the real API. */
async function get<T>(path: string, offline: T, ttl = 0, onError: T = offline): Promise<T> {
  if (ttl > 0) {
    const hit = CACHE.get(path);
    if (hit && Date.now() - hit.t < ttl) return hit.v as T;
  }
  let res: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    res = await fetch(`${BASE_URL}${path}`,
                      { headers: HEADERS, signal: ctrl.signal, credentials: "include" });
    clearTimeout(t);
  } catch {
    setOnline(false);
    return offline;
  }
  setOnline(true);
  if (!res.ok) {
    notifyUnauthorized(res.status);
    return onError;
  }
  try {
    const parsed = (await res.json()) as T;
    if (ttl > 0) CACHE.set(path, { t: Date.now(), v: parsed });
    return parsed;
  } catch {
    return onError;
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

// ---- wave-2 back-office views -----------------------------------------------
export type QcStatus = "pending" | "passed" | "failed";
export interface QcVerdict { status: QcStatus; note: string; by: string; at: string }
export interface MediaQcEpisode { number: number; title: string; hasMedia: boolean; qc: QcVerdict }
export interface MediaQcSeries {
  slug: string; title: string; episodeCount: number;
  episodes_with_media: number; episodes_missing: number;
  qc: Record<QcStatus, number>;
  episodes: MediaQcEpisode[];
}

export interface ModerationItem {
  id: string; kind: "rating" | "grievance"; title: string; detail: string;
  at: string; to: string;
  slug?: string; rating?: string; by?: string;
  gid?: string; status?: string; channel?: string;
  reviewed?: { by: string; at: string; note: string };
}

export type LocStatus = "none" | "in_progress" | "done";
export interface LocCell { status: LocStatus; owner: string; due: string; by: string; at: string }
export interface LocSeries {
  slug: string; title: string; primary: string; language: string;
  langs: Record<string, Record<string, LocCell>>;
}

export interface WritersRow {
  slug: string; title: string; episodeCount: number; completeness_pct: number;
  hooks: number; outlines: number; by: string; updated_at: string;
}
export interface Outline { number: number; beat: string }
export interface WritersWorkspace {
  slug: string; title: string; episodeCount: number; completeness_pct: number;
  logline: string; hooks: string[]; episode_outlines: Outline[]; notes: string;
  by: string; updated_at: string;
}

export interface ProgrammingRow {
  slug: string; title: string; language: string; episodeCount: number;
  status: string; release_at: string; scheduled_by: string; scheduled_at: string;
}

export const api = {
  async getOverview(): Promise<Overview> {
    return get<Overview>("/overview", MOCK_OVERVIEW, 0, null as unknown as Overview);
  },
  async listSeries(): Promise<Series[]> {
    return get<Series[]>("/catalog/series", MOCK_SERIES, CACHE_TTL_MS, []);
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
      `/users?${p}`, { users: fallback, total: fallback.length }, 0, { users: [], total: 0 });
  },
  async listApprovals(status = "pending"): Promise<Approval[]> {
    return get<Approval[]>(`/approvals?status=${status}`, MOCK_APPROVALS, 0, []);
  },
  async listFlags(): Promise<FeatureFlag[]> {
    return get<FeatureFlag[]>("/config/flags", MOCK_FLAGS, CACHE_TTL_MS, []);
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
      { rows, chain_ok: true, total: rows.length }, 0, { rows: [], chain_ok: true, total: 0 });
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
  async invoices(): Promise<{
    rows: { id: string; user_id: string; sku: string; coins: number;
            bonus_coins: number; total_minor: number; taxable_minor: number;
            gst_minor: number; gst_rate_pct: number; created_at: string }[];
    totals: { count: number; gross_minor: number; gst_minor: number };
  }> {
    return get("/invoices", { rows: [],
                              totals: { count: 0, gross_minor: 0, gst_minor: 0 } });
  },
  async outbox(kind = ""): Promise<{
    rows: { id: number; kind: string; recipient: string; subject: string;
            body: string; status: string; detail: string; created_at: string }[];
    transports: { email: boolean; push: boolean };
  }> {
    const p = new URLSearchParams();
    if (kind) p.set("kind", kind);
    return get(`/outbox?${p}`,
               { rows: [], transports: { email: false, push: false } });
  },
  async listDevices(userId: string):
      Promise<{ devices: { ua: string; ip: string; first_seen: string;
                           last_seen: string }[] }> {
    return get(`/users/${userId}/devices`, { devices: [] });
  },
  // Wave-2 boards: offline shows an honest empty board (the banner says why),
  // never sample verdicts or schedules that could pass for real ones.
  async mediaQc(): Promise<{ series: MediaQcSeries[]; generated_at: string }> {
    return get("/media/qc", { series: [], generated_at: "" });
  },
  async moderation(): Promise<{ items: ModerationItem[]; open: number }> {
    return get("/moderation", { items: [], open: 0 });
  },
  async localization(): Promise<{ series: LocSeries[]; languages: string[]; kinds: string[] }> {
    return get("/localization",
               { series: [], languages: ["hi", "ta", "te"], kinds: ["dub", "sub"] });
  },
  async writersIndex(): Promise<{ series: WritersRow[] }> {
    return get("/writers", { series: [] });
  },
  async writersWorkspace(slug: string): Promise<WritersWorkspace | null> {
    return get<WritersWorkspace | null>(`/writers/${slug}`, null);
  },
  async programming(): Promise<{ series: ProgrammingRow[]; now: string }> {
    return get("/programming", { series: [], now: "" });
  },
};

/** Mutations. Every call resolves to the parsed body, or `{ offline: true }`
 *  when the server is absent — callers reconcile against the SERVER's answer
 *  (#026/#063), never assume success. */
export type MutationResult =
  | ({ offline?: false; error?: string; httpStatus?: number; login?: string } & Record<string, unknown>)
  | { offline: true };

export async function send(path: string, method: string, body?: unknown): Promise<MutationResult> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "content-type": "application/json", ...HEADERS },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "include",
    });
    setOnline(true);
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      notifyUnauthorized(res.status);
      // A step-up demand carries where to re-authenticate.
      const login = res.headers?.get?.("X-Katha-Login") ?? undefined;
      return { error: String(parsed.detail ?? `HTTP ${res.status}`), httpStatus: res.status, login };
    }
    return parsed;
  } catch {
    setOnline(false);
    return { offline: true };
  }
}

export const mutate = {
  // idempotencyKey: one per click; a retry after a timeout lands once (#A10).
  adjust: (userId: string, coins: number, reasonCode: string, note: string,
           idempotencyKey?: string) =>
    send("/wallet/adjust", "POST", { user_id: userId, coins, reason_code: reasonCode, note,
                                     ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}) }),
  refund: (userId: string, txId: string) =>
    send("/wallet/refund", "POST", { user_id: userId, tx_id: txId }),
  erase: (userId: string) => send(`/users/${userId}/erase`, "POST"),
  outboxRetry: (id: number) => send(`/outbox/${id}/retry`, "POST"),
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
  annotateAudit: (id: number, note: string) =>
    send(`/audit/${id}/note`, "PATCH", { note }),
  notifyDrop: (slug: string, episode: number, resend = false) =>
    send(`/catalog/series/${slug}/notify-drop`, "POST", { episode, resend }),
  setQc: (slug: string, number: number, status: QcStatus, note = "") =>
    send(`/media/qc/${slug}/${number}`, "PATCH", { status, note }),
  modReviewed: (id: string, note = "") =>
    send(`/moderation/${encodeURIComponent(id)}/reviewed`, "POST", { note }),
  setLocalization: (slug: string, cell: { lang: string; kind: string; status: LocStatus;
                                          owner: string; due: string }) =>
    send(`/localization/${slug}`, "PATCH", cell),
  saveWriters: (slug: string, ws: { logline: string; hooks: string[];
                                    episode_outlines: Outline[]; notes: string }) =>
    send(`/writers/${slug}`, "PUT", ws),
  setSchedule: (slug: string, releaseAt: string) =>
    send(`/catalog/series/${slug}/schedule`, "PATCH",
         { release_at: releaseAt, confirm: slug }),
  // The typed "PRICING" confirm is what the operator entered — never auto-filled.
  bulkPricing: (slugs: string[], fields: { coin_price?: number; free_episodes?: number },
                confirm: string) =>
    send("/catalog/pricing/bulk", "POST", { slugs, ...fields, confirm }),
};

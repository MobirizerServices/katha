export type SeriesStatus = "live" | "sched" | "qc" | "draft" | "arch";

export interface Series {
  id: string;
  slug: string;
  title: string;
  synopsis: string;
  genres: string[];
  language: string; // display language (Hindi/Tamil/Telugu)
  episodeCount: number;
  liveCount: number;
  freeEpisodes: number; // free_episode_count (10)
  coinPrice: number; // episode_coin_price (30)
  bundleDiscountPct: number; // 25
  status: SeriesStatus;
  rating: string;
  owner: string;
  updatedAt: number;
}

export interface Wallet {
  bought: number;
  bonus: number; // bonus coins are spent before bought coins
  unlocked: number; // episodes unlocked
  ltv: string;
}

export interface AdminUser {
  id: string;
  phone: string;
  name: string;
  languages: string;
  wallet: Wallet;
  lastActive: string;
  flags: string[];
  devices: string[];
  payer: string;
}

export interface Approval {
  id: string;
  kind: string;
  detail: string;
  requestedBy: string; // requester — can never approve their own
  when: string;
  needs: string;
  amount?: number;
  userId?: string;
  status?: "pending" | "approved" | "rejected";
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  requesterToday?: number;
  approvedBy?: string | null;
}

export interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  env: string;
  guarded?: boolean;
  owner?: string;
  review_by?: string;
}

export interface AuditEntry {
  ts: number | string;      // legacy mock rows carry epoch ms; server rows ISO
  actor: string;
  action: string;
  entity: string;
  change: string;
  id?: number;
  ip?: string;
  user_agent?: string;
  hash?: string;
}

export interface Kpi {
  label: string;
  value: string;
  delta?: string;
  deltaDir?: "up" | "down";
}

export interface AttentionItem {
  id: string;
  severity: "danger" | "warn" | "info";
  title: string;
  detail: string;
  when: string;
  to: string;
}

export interface PipelineStage {
  label: string;
  count: number;
  pct: number;
  tone: "" | "ok" | "info";
}

export interface Overview {
  kpis: Kpi[];
  attention: AttentionItem[];
  pipeline: PipelineStage[];
}

export interface LedgerTxn {
  id: string;
  type: string;
  amount_bought: number;
  amount_bonus: number;
  reference_type: string;
  reference_id: string;
  created_at: string;
}

export interface UserLedger {
  user_id: string;
  wallet: { balance_bought: number; balance_bonus: number; total: number };
  transactions: LedgerTxn[];
}

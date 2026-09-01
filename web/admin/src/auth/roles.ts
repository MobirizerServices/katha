// RBAC — mirrors the reviewed admin design (Katha_Admin_Dashboard_v0.2).
// Roles map from Google Workspace IdP groups. Sensitive money actions above
// thresholds need a second person (dual approval).

export type Role =
  | "admin"
  | "content"
  | "qc"
  | "support"
  | "finance"
  | "analyst"
  | "ro";

export const ROLE_NAMES: Record<Role, string> = {
  admin: "Admin",
  content: "Content Ops",
  qc: "QC / Moderator",
  support: "Support",
  finance: "Finance",
  analyst: "Analyst",
  ro: "Read-only",
};

export const ROLE_ORDER: Role[] = [
  "admin",
  "content",
  "qc",
  "support",
  "finance",
  "analyst",
  "ro",
];

// Which views each role may open. "*" for admin = all.
const ROLE_VIEWS: Record<Role, "*" | string[]> = {
  admin: "*",
  content: ["overview", "catalog", "config", "audit", "approvals", "access"],
  qc: ["overview", "catalog", "audit", "access"],
  support: ["overview", "users", "audit", "approvals", "grievances", "access", "outbox"],
  finance: ["overview", "users", "config", "audit", "approvals", "access", "outbox"],
  analyst: ["overview", "config", "access", "audit", "outbox"],
  ro: ["overview", "catalog", "audit", "access"],
};

export function canView(role: Role, view: string): boolean {
  const v = ROLE_VIEWS[role];
  return v === "*" || v.indexOf(view) >= 0;
}

// Can this role perform an action gated to a comma-separated role list.
// Admin can always act.
export function canAct(role: Role, roles: string): boolean {
  if (role === "admin") return true;
  return roles.split(",").map((r) => r.trim()).indexOf(role) >= 0;
}

// Dual-approval thresholds (product facts).
export const DUAL_APPROVAL = {
  coinAdjustment: 500, // coin adjustments above 500 need a second approver
  priceChangePct: 0.2, // price or free-count changes above 20%
};

// Permission matrix rendered on the Roles & access view. Columns follow
// ROLE_ORDER. Cell values: "yes" | "no" | note string.
export interface MatrixRow {
  cap: string;
  cells: string[]; // one per role in ROLE_ORDER
}
export const PERMISSION_MATRIX: MatrixRow[] = [
  { cap: "Create / edit series & episodes", cells: ["yes", "yes", "no", "no", "no", "no", "no"] },
  { cap: "Publish / schedule / takedown", cells: ["yes", "yes", "takedown", "no", "no", "no", "no"] },
  { cap: "Rating & moderation decisions", cells: ["yes", "no", "yes", "no", "no", "no", "no"] },
  { cap: "View user PII (phone)", cells: ["yes", "no", "no", "yes", "masked", "no", "no"] },
  { cap: "Coin adjustment ≤ 500", cells: ["yes", "no", "no", "yes", "yes", "no", "no"] },
  { cap: "Coin adjustment > 500", cells: ["2 approvers", "no", "no", "request", "approve", "no", "no"] },
  { cap: "Finance imports & GST", cells: ["yes", "no", "no", "no", "yes", "no", "no"] },
  { cap: "Flags, experiments, SKUs", cells: ["yes", "flags", "no", "no", "SKUs", "experiments", "no"] },
  { cap: "Analytics dashboards", cells: ["yes", "yes", "yes", "yes", "yes", "yes", "yes"] },
  { cap: "Audit log", cells: ["yes", "own", "own", "own", "yes", "no", "yes"] },
];

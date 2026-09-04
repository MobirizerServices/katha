import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { api, isOnline, mutate, onOnlineChange, onUnauthorized } from "./api/client";
import type { AttentionItem, Health, Identity, MutationResult } from "./api/client";
import type { Approval, AuditEntry, FeatureFlag } from "./api/types";
import { ROLE_NAMES } from "./auth/roles";
import type { Role } from "./auth/roles";

export const ME = "riya";

export interface ToastMsg {
  id: number;
  text: string;
  kind: "info" | "error";
}

interface Store {
  role: Role;
  /** The signed-in operator's id: their OIDC email, or the dev header actor. */
  me: string;
  setRole: (r: Role) => void;
  identity: Identity | null;
  signedOut: boolean;
  logout: () => Promise<void>;
  online: boolean;
  health: Health | null;
  attention: AttentionItem[];
  refreshSignals: () => void;
  approvals: Approval[];
  reloadApprovals: (status?: string) => Promise<void>;
  addApproval: (a: Approval) => void;
  resolveApproval: (id: string, decision: "approved" | "rejected", by: string,
                    note?: string) => Promise<MutationResult>;
  audit: AuditEntry[];
  addAudit: (e: Omit<AuditEntry, "ts">) => void;
  flags: FeatureFlag[];
  toggleFlag: (key: string, confirm?: string) => Promise<MutationResult>;
  setFlagPct: (key: string, pct: number, confirm?: string) => Promise<MutationResult>;
  toasts: ToastMsg[];
  showToast: (msg: string, kind?: "info" | "error") => void;
}

const Ctx = createContext<Store | null>(null);
let toastSeq = 1;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [role, setRoleRaw] = useState<Role>("admin");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [online, setOnlineState] = useState(isOnline());
  const [health, setHealth] = useState<Health | null>(null);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const showToast = useCallback((text: string, kind: "info" | "error" = "info") => {
    const id = toastSeq++;
    setToasts((prev) => [...prev.slice(-2), { id, text, kind }]);
    window.setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const refreshSignals = useCallback(() => {
    void api.health().then(setHealth);
    void api.attention().then((a) => setAttention(a.items));
  }, []);

  // Identity is fetched at boot, after sign-out, and whenever the server
  // answers 401/403 mid-session (expired cookie, revoked role): the operator
  // is routed to Login instead of being shown sample data.
  const refreshIdentity = useCallback(async () => {
    const me = await api.authMe();
    setIdentity(me);
    if (me?.mode === "oidc" && me.authenticated && me.role) {
      setRoleRaw(me.role as Role); // the server's answer wins — no previewing
    }
  }, []);

  const logout = useCallback(async () => {
    const res = await mutate.logout();
    if ("offline" in res) {
      showToast("Offline — could not reach the server to sign out", "error");
      return;
    }
    await refreshIdentity();
    showToast("Signed out");
  }, [refreshIdentity, showToast]);

  const reloadApprovals = useCallback(async (status = "pending") => {
    setApprovals(await api.listApprovals(status));
  }, []);

  useEffect(() => {
    void reloadApprovals();
    void api.listAudit({}).then((a) => setAudit(a.rows));
    void api.listFlags().then(setFlags);
    void refreshIdentity();
    refreshSignals();
    const t = window.setInterval(refreshSignals, 60_000);
    const off = onOnlineChange(setOnlineState);
    const offAuth = onUnauthorized(() => void refreshIdentity());
    return () => {
      window.clearInterval(t);
      off();
      offAuth();
    };
  }, [refreshSignals, reloadApprovals, refreshIdentity]);

  const setRole = useCallback(
    (r: Role) => {
      setRoleRaw(r);
      showToast(`Previewing as ${ROLE_NAMES[r]} — visual only; the server still sees your real role`);
    },
    [showToast]
  );

  const addAudit = useCallback((e: Omit<AuditEntry, "ts">) => {
    setAudit((prev) => [{ ts: Date.now(), ...e }, ...prev]);
  }, []);

  const addApproval = useCallback((a: Approval) => {
    setApprovals((prev) => [a, ...prev]);
  }, []);

  const resolveApproval = useCallback(
    async (id: string, decision: "approved" | "rejected", by: string, note = "") => {
      const res = decision === "approved"
        ? await mutate.approve(id)
        : await mutate.reject(id, note);
      if (!("offline" in res) && res.error) return res;
      setApprovals((prev) => {
        const a = prev.find((x) => x.id === id);
        if (a) {
          setAudit((au) => [
            {
              ts: Date.now(),
              actor: by,
              action: decision === "approved" ? "approval.approve" : "approval.reject",
              entity: a.kind,
              change: `${decision} · requested by ${a.requestedBy}`,
            },
            ...au,
          ]);
        }
        return prev.filter((x) => x.id !== id);
      });
      return res;
    },
    []
  );

  const toggleFlag = useCallback(
    async (key: string, confirm?: string) => {
      const flag = flags.find((f) => f.key === key);
      if (!flag) return { error: "unknown flag" } as const;
      const next = !flag.enabled;
      const res = await mutate.setFlag(key, next, flag.pct ?? 100, confirm);
      if (!("offline" in res) && res.error) {
        showToast(`Flag not changed: ${res.error}`, "error");   // #063: never lie
        return res;
      }
      // offline: local sample flip below, clearly non-authoritative
      setFlags((prev) => prev.map((f) => (f.key === key ? { ...f, enabled: next } : f)));
      setAudit((au) => [
        { ts: Date.now(), actor: ME, action: "flag.update", entity: key,
          change: `${flag?.enabled ? "on" : "off"} → ${next ? "on" : "off"}` },
        ...au,
      ]);
      return res;
    },
    [flags, showToast]
  );

  const signedOut = identity?.mode === "oidc" && !identity.authenticated;
  const me = (identity?.mode === "oidc" && identity.email) || ME;

  const setFlagPct = useCallback(
    async (key: string, pct: number, confirm?: string) => {
      const flag = flags.find((f) => f.key === key);
      if (!flag) return { error: "unknown flag" } as const;
      const res = await mutate.setFlag(key, flag.enabled, pct, confirm);
      if (!("offline" in res) && res.error) {
        showToast(`Rollout not changed: ${res.error}`, "error");
        return res;
      }
      setFlags((prev) => prev.map((f) => (f.key === key ? { ...f, pct } : f)));
      setAudit((au) => [
        { ts: Date.now(), actor: ME, action: "flag.rollout", entity: key,
          change: `${flag.pct ?? 100}% → ${pct}%` },
        ...au,
      ]);
      return res;
    },
    [flags, showToast]
  );

  const value = useMemo<Store>(
    () => ({
      role, me, setRole, identity, signedOut, logout, online, health, attention,
      refreshSignals, approvals, reloadApprovals, addApproval, resolveApproval,
      audit, addAudit, flags, toggleFlag, setFlagPct, toasts, showToast,
    }),
    [role, me, setRole, identity, signedOut, logout, online, health, attention,
     refreshSignals, approvals, reloadApprovals, addApproval, resolveApproval,
     audit, addAudit, flags, toggleFlag, setFlagPct, toasts, showToast]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}

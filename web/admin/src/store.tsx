import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, mutate } from "./api/client";
import type { Approval, AuditEntry, FeatureFlag } from "./api/types";
import { ROLE_NAMES, type Role } from "./auth/roles";

// The signed-in admin. In production this comes from the SSO session; here it
// is fixed so the self-approval rule has a stable identity to compare against.
export const ME = "Riya Menon";

interface Store {
  role: Role;
  setRole: (r: Role) => void;
  approvals: Approval[];
  addApproval: (a: Approval) => void;
  resolveApproval: (id: string, decision: "approved" | "rejected", by: string) => void;
  audit: AuditEntry[];
  addAudit: (e: Omit<AuditEntry, "ts">) => void;
  flags: FeatureFlag[];
  toggleFlag: (key: string) => void;
  toast: string | null;
  showToast: (msg: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used within StoreProvider");
  return v;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [role, setRoleRaw] = useState<Role>("admin");
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api.listApprovals().then(setApprovals);
    api.listAudit().then(setAudit);
    api.listFlags().then(setFlags);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 4200);
  }, []);

  const addAudit = useCallback((e: Omit<AuditEntry, "ts">) => {
    setAudit((prev) => [{ ts: Date.now(), ...e }, ...prev]);
  }, []);

  const setRole = useCallback(
    (r: Role) => {
      setRoleRaw(r);
      showToast(`Previewing as ${ROLE_NAMES[r]}`);
    },
    [showToast]
  );

  const addApproval = useCallback((a: Approval) => {
    setApprovals((prev) => [a, ...prev]);
  }, []);

  const resolveApproval = useCallback(
    (id: string, decision: "approved" | "rejected", by: string) => {
      // Live server first (no-op when absent); local state mirrors either way.
      if (decision === "approved") void mutate.approve(id);
      else void mutate.reject(id);
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
    },
    []
  );

  const toggleFlag = useCallback(
    (key: string) => {
      setFlags((prev) =>
        prev.map((f) => {
          if (f.key !== key) return f;
          const next = !f.enabled;
          void mutate.setFlag(key, next);   // persists via admin-api when live
          setAudit((au) => [
            {
              ts: Date.now(),
              actor: ME,
              action: "flag.update",
              entity: key,
              change: `${f.enabled ? "on" : "off"} → ${next ? "on" : "off"}`,
            },
            ...au,
          ]);
          return { ...f, enabled: next };
        })
      );
    },
    []
  );

  const value = useMemo<Store>(
    () => ({
      role,
      setRole,
      approvals,
      addApproval,
      resolveApproval,
      audit,
      addAudit,
      flags,
      toggleFlag,
      toast,
      showToast,
    }),
    [role, setRole, approvals, addApproval, resolveApproval, audit, addAudit, flags, toggleFlag, toast, showToast]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

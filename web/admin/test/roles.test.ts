import { describe, it, expect } from "vitest";
import {
  canView,
  canAct,
  ROLE_NAMES,
  ROLE_ORDER,
  DUAL_APPROVAL,
  PERMISSION_MATRIX,
  type Role,
} from "../src/auth/roles";

describe("RBAC — canView", () => {
  it("admin can open every view (wildcard)", () => {
    for (const view of ["overview", "catalog", "users", "approvals", "config", "audit", "access", "anything"]) {
      expect(canView("admin", view)).toBe(true);
    }
  });

  it("support cannot open finance-only config but can open users", () => {
    expect(canView("support", "users")).toBe(true);
    expect(canView("support", "config")).toBe(false);
    expect(canView("support", "catalog")).toBe(false);
  });

  it("finance can open users + config, cannot open catalog", () => {
    expect(canView("finance", "users")).toBe(true);
    expect(canView("finance", "config")).toBe(true);
    expect(canView("finance", "catalog")).toBe(false);
  });

  it("qc / analyst / ro / content gate views as designed", () => {
    expect(canView("qc", "catalog")).toBe(true);
    expect(canView("qc", "users")).toBe(false);
    expect(canView("analyst", "config")).toBe(true);
    expect(canView("analyst", "users")).toBe(false);
    expect(canView("ro", "audit")).toBe(true);
    expect(canView("ro", "approvals")).toBe(false);
    expect(canView("content", "approvals")).toBe(true);
    expect(canView("content", "users")).toBe(false);
  });

  it("wave-2 views follow the mockup: content/qc get the content boards, finance gets Finance, components is admin-only", () => {
    for (const v of ["media", "moderation", "localization", "writers", "programming", "analytics"]) {
      expect(canView("content", v)).toBe(true);
      expect(canView("qc", v)).toBe(true);
      expect(canView("support", v)).toBe(v === "analytics");
    }
    expect(canView("finance", "finance")).toBe(true);
    expect(canView("support", "finance")).toBe(false);
    for (const r of ROLE_ORDER) {
      expect(canView(r, "components")).toBe(r === "admin");
      expect(canView(r, "analytics")).toBe(true);
    }
  });

  it("everyone can open overview", () => {
    for (const r of ROLE_ORDER) expect(canView(r, "overview")).toBe(true);
  });
});

describe("RBAC — canAct", () => {
  it("admin can always act regardless of the allowed list", () => {
    expect(canAct("admin", "finance")).toBe(true);
    expect(canAct("admin", "support,finance")).toBe(true);
    expect(canAct("admin", "nobody")).toBe(true);
  });

  it("support can make small money adjustments but finance-only actions are blocked", () => {
    expect(canAct("support", "support,finance")).toBe(true);
    expect(canAct("support", "finance")).toBe(false);
  });

  it("finance can decide approvals, support cannot", () => {
    expect(canAct("finance", "finance")).toBe(true);
    expect(canAct("support", "finance")).toBe(false);
  });

  it("content ops can toggle flags, others cannot", () => {
    expect(canAct("content", "content")).toBe(true);
    expect(canAct("qc", "content")).toBe(false);
  });

  it("trims whitespace in the comma-separated list", () => {
    expect(canAct("finance", "support, finance")).toBe(true);
  });
});

describe("dual-approval thresholds (product facts)", () => {
  it("coin adjustments above 500 need a second approver", () => {
    expect(DUAL_APPROVAL.coinAdjustment).toBe(500);
    expect(600 > DUAL_APPROVAL.coinAdjustment).toBe(true);
    expect(500 > DUAL_APPROVAL.coinAdjustment).toBe(false);
  });

  it("price / free-count changes above 20% need a second approver", () => {
    expect(DUAL_APPROVAL.priceChangePct).toBe(0.2);
  });
});

describe("permission matrix shape", () => {
  it("names + order cover all seven roles", () => {
    expect(ROLE_ORDER).toHaveLength(7);
    for (const r of ROLE_ORDER) {
      expect(ROLE_NAMES[r]).toBeTruthy();
    }
    const uniq = new Set<Role>(ROLE_ORDER);
    expect(uniq.size).toBe(7);
  });

  it("every matrix row has exactly one cell per role", () => {
    for (const row of PERMISSION_MATRIX) {
      expect(row.cells).toHaveLength(ROLE_ORDER.length);
      expect(row.cap).toBeTruthy();
    }
  });

  it("encodes the >500 coin adjustment dual-control rule", () => {
    const row = PERMISSION_MATRIX.find((r) => r.cap === "Coin adjustment > 500")!;
    // columns follow ROLE_ORDER: admin, content, qc, support, finance, analyst, ro
    expect(row.cells[0]).toBe("2 approvers"); // admin
    expect(row.cells[3]).toBe("request"); // support requests
    expect(row.cells[4]).toBe("approve"); // finance approves
    expect(row.cells[1]).toBe("no"); // content cannot
  });

  it("lists the wave-2 capabilities with the same roles the server enforces", () => {
    const row = (cap: string) => PERMISSION_MATRIX.find((r) => r.cap === cap)!.cells;
    expect(row("Media QC verdicts")).toEqual(["yes", "yes", "yes", "no", "no", "no", "no"]);
    expect(row("Bulk pricing")[4]).toBe("yes");
    expect(row("Components (internal)")).toEqual(["yes", "no", "no", "no", "no", "no", "no"]);
    expect(row("Programming calendar")[2]).toBe("view");
  });

  it("finance sees masked PII in the matrix", () => {
    const row = PERMISSION_MATRIX.find((r) => r.cap === "View user PII (phone)")!;
    expect(row.cells[4]).toBe("masked");
    expect(row.cells[3]).toBe("yes"); // support sees full phone
  });
});

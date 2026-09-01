import { describe, it, expect } from "vitest";
import { NAV, ALL_NAV_ITEMS } from "../src/nav";

describe("nav", () => {
  it("flattens all groups into a single item list", () => {
    const fromGroups = NAV.flatMap((g) => g.items);
    expect(ALL_NAV_ITEMS).toHaveLength(fromGroups.length);
    expect(ALL_NAV_ITEMS.map((i) => i.view)).toEqual(fromGroups.map((i) => i.view));
  });

  it("covers every routed view exactly once", () => {
    const views = ALL_NAV_ITEMS.map((i) => i.view).sort();
    expect(views).toEqual(
      ["access", "approvals", "audit", "catalog", "config", "grievances", "overview", "users"].sort()
    );
  });

  it("each item's path matches /<view>", () => {
    for (const it of ALL_NAV_ITEMS) {
      expect(it.path).toBe(`/${it.view}`);
      expect(it.label).toBeTruthy();
      expect(it.icon).toBeTruthy();
    }
  });
});

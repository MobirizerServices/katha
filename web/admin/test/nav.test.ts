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
      ["access", "analytics", "approvals", "audit", "catalog", "components", "config",
       "finance", "grievances", "localization", "media", "moderation", "outbox",
       "overview", "programming", "users", "writers"].sort()
    );
  });

  it("keyboard hints are unique g-chords", () => {
    const kbs = ALL_NAV_ITEMS.map((i) => i.kb).filter(Boolean) as string[];
    expect(new Set(kbs).size).toBe(kbs.length);
    for (const kb of kbs) expect(kb).toMatch(/^g [a-z]$/);
  });

  // ADM-17: the Components page promises "every module is reachable by g +
  // letter" — that promise only holds if every item actually carries a chord.
  it("every module has a chord", () => {
    expect(ALL_NAV_ITEMS.filter((i) => !i.kb)).toEqual([]);
  });

  it("each item's path matches /<view>", () => {
    for (const it of ALL_NAV_ITEMS) {
      expect(it.path).toBe(`/${it.view}`);
      expect(it.label).toBeTruthy();
      expect(it.icon).toBeTruthy();
    }
  });
});

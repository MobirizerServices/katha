// Sidebar navigation, grouped to match the reviewed admin mockup. Each item's
// `view` key gates against the role's allowed views (src/auth/roles.ts).
export interface NavItem {
  view: string;
  path: string;
  label: string;
  icon: string; // emoji glyph stand-in for the mockup's line icons
  kb?: string; // keyboard hint shown in the mockup
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    title: "Content",
    items: [
      { view: "overview", path: "/overview", label: "Overview", icon: "▤", kb: "g o" },
      { view: "catalog", path: "/catalog", label: "Catalog", icon: "▦", kb: "g c" },
    ],
  },
  {
    title: "Operations",
    items: [
      { view: "users", path: "/users", label: "Users & wallet", icon: "◉", kb: "g u" },
      { view: "approvals", path: "/approvals", label: "Approvals inbox", icon: "✓", kb: "g a" },
      { view: "grievances", path: "/grievances", label: "Grievances", icon: "☎", kb: "g g" },
    ],
  },
  {
    title: "Growth",
    items: [
      { view: "config", path: "/config", label: "Config & experiments", icon: "⚑", kb: "g x" },
    ],
  },
  {
    title: "Platform",
    items: [
      { view: "audit", path: "/audit", label: "Audit log", icon: "▤" },
      { view: "access", path: "/access", label: "Roles & access", icon: "⚿" },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((g) => g.items);

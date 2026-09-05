// Sidebar navigation, grouped to match the reviewed admin mockup. Each item's
// `view` key gates against the role's allowed views (src/auth/roles.ts).
export interface NavItem {
  view: string;
  path: string;
  label: string;
  icon: string; // emoji glyph stand-in for the mockup's line icons
  kb?: string; // keyboard hint shown in the mockup ("g" then a letter)
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
      { view: "media", path: "/media", label: "Media & QC", icon: "⇪", kb: "g m" },
      { view: "moderation", path: "/moderation", label: "Moderation & ratings", icon: "⛨", kb: "g r" },
      { view: "localization", path: "/localization", label: "Localization", icon: "文", kb: "g l" },
      { view: "writers", path: "/writers", label: "AI Writers’ Room", icon: "✎", kb: "g w" },
      { view: "programming", path: "/programming", label: "Programming", icon: "▦", kb: "g p" },
    ],
  },
  {
    title: "Operations",
    items: [
      { view: "users", path: "/users", label: "Users & wallet", icon: "◉", kb: "g u" },
      { view: "approvals", path: "/approvals", label: "Approvals inbox", icon: "✓", kb: "g a" },
      { view: "grievances", path: "/grievances", label: "Grievances", icon: "☎", kb: "g g" },
      { view: "finance", path: "/finance", label: "Finance", icon: "₹", kb: "g f" },
    ],
  },
  {
    title: "Growth",
    items: [
      { view: "config", path: "/config", label: "Config & experiments", icon: "⚑", kb: "g x" },
      { view: "analytics", path: "/analytics", label: "Analytics", icon: "◫", kb: "g n" },
    ],
  },
  {
    title: "Platform",
    items: [
      { view: "audit", path: "/audit", label: "Audit log", icon: "▤", kb: "g d" },
      { view: "outbox", path: "/outbox", label: "Outbox", icon: "✉", kb: "g b" },
      { view: "access", path: "/access", label: "Roles & access", icon: "⚿", kb: "g k" },
      { view: "components", path: "/components", label: "Components", icon: "▣", kb: "g y" },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((g) => g.items);

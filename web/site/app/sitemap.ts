import type { MetadataRoute } from "next";
import { SERIES } from "@/lib/catalog";

const SITE = "https://katha.example";

/** The landing page, the public catalog pages (browse, search) and one entry
 * per series page — the indexable surface. /mylist, /profile, /watch and
 * /coins are per-account and stay noindex. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE}/browse`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE}/search`, changeFrequency: "weekly", priority: 0.5 },
    ...SERIES.map((s) => ({
      url: `${SITE}/series/${s.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}

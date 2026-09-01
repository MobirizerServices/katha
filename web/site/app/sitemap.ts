import type { MetadataRoute } from "next";
import { SERIES } from "@/lib/catalog";

const SITE = "https://katha.example";

/** The landing page plus one entry per series page — the indexable surface. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/`, changeFrequency: "daily", priority: 1 },
    ...SERIES.map((s) => ({
      url: `${SITE}/series/${s.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}

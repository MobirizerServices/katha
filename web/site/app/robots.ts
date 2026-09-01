import type { MetadataRoute } from "next";

const SITE = "https://katha.example";

/** Index the catalog, keep crawlers out of the logged-in player + store. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/watch/", "/coins"] }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}

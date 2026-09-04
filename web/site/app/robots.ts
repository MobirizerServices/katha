import type { MetadataRoute } from "next";

const SITE = "https://katha.example";

/** Index the catalog, keep crawlers out of the logged-in player, store and account pages. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/watch/", "/coins", "/mylist", "/profile"] }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}

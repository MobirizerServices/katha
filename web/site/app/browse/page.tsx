import { Suspense } from "react";
import type { Metadata } from "next";
import Browse from "@/components/Browse";
import SiteFooter from "@/components/SiteFooter";
import { SERIES } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Browse series",
  description: "Every Katha micro-drama by genre and language — Hindi, Tamil and Telugu. First 10 episodes of each are free.",
  alternates: { canonical: "/browse" },
};

/** Static grid from the seed catalog; the filter chips are client state in
 * the query string, so the page is pre-rendered and Suspense wraps the part
 * that reads ?genre= / ?lang=. */
export default function BrowsePage() {
  return (
    <>
      <Suspense fallback={<p className="wrap muted" style={{ paddingTop: 30 }}>Loading…</p>}>
        <Browse series={SERIES} />
      </Suspense>
      <SiteFooter />
    </>
  );
}

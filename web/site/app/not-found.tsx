import Link from "next/link";
import type { Metadata } from "next";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

/** Anything that isn't a page: a styled dead end with a way back into the
 * catalog, rather than the framework's black default. */
export default function NotFound() {
  return (
    <>
      <div className="empty" style={{ paddingTop: 110 }}>
        <h3>We couldn&rsquo;t find that page</h3>
        <p>The series may have been renamed, or the link may be old.</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link className="btn p" href="/browse" style={{ display: "inline-flex" }}>
            Browse all series
          </Link>
          <Link className="btn s" href="/search" style={{ display: "inline-flex" }}>
            Search
          </Link>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}

import { Suspense } from "react";
import type { Metadata } from "next";
import Search from "@/components/Search";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Search",
  description: "Find a Katha series by title, genre, mood or actor.",
  alternates: { canonical: "/search" },
};

export default function SearchPage() {
  return (
    <>
      <Suspense fallback={<p className="wrap muted" style={{ paddingTop: 30 }}>Loading…</p>}>
        <Search />
      </Suspense>
      <SiteFooter />
    </>
  );
}

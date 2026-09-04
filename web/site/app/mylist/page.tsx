import type { Metadata } from "next";
import MyList from "@/components/MyList";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = { title: "My list", robots: { index: false, follow: false } };

export default function MyListPage() {
  return (
    <>
      <MyList />
      <SiteFooter />
    </>
  );
}

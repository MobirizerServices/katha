import type { Metadata } from "next";
import Profile from "@/components/Profile";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = { title: "Profile", robots: { index: false, follow: false } };

export default function ProfilePage() {
  return (
    <>
      <Profile />
      <SiteFooter />
    </>
  );
}

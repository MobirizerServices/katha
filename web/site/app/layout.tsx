import type { Metadata, Viewport } from "next";
import { Anton, Fraunces } from "next/font/google";
import "./globals.css";

// The two brand voices: Anton for display titles (hand-painted film-poster
// condensation), Fraunces italic for the wordmark (a story publisher, not a
// tech platform). Self-hosted at build time by next/font.
const display = Anton({ weight: "400", subsets: ["latin"],
                        variable: "--font-display", display: "swap" });
const wordmark = Fraunces({ weight: "600", style: "italic", subsets: ["latin"],
                            variable: "--font-wordmark", display: "swap" });
import { WalletProvider } from "@/components/WalletProvider";
import SiteHeader from "@/components/SiteHeader";

const SITE = "https://katha.example";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Katha — Stories in 2 minutes. In your language. No ads.",
    template: "%s — Katha",
  },
  description:
    "Katha is a micro-drama app: Hindi, Tamil and Telugu originals in 1–2 minute episodes. Watch the first 10 episodes of every series free, then unlock the rest for about ₹4.5 each.",
  applicationName: "Katha",
  alternates: {
    canonical: "/en",
    languages: {
      "en-IN": "/en",
      "hi-IN": "/hi",
      "ta-IN": "/ta",
      "te-IN": "/te",
    },
  },
  openGraph: {
    type: "website",
    url: `${SITE}/en`,
    title: "Katha — Stories in 2 minutes",
    description: "Micro-dramas in Hindi, Tamil and Telugu. First 10 episodes free. No ads.",
    siteName: "Katha",
  },
  twitter: {
    card: "summary_large_image",
    title: "Katha — Stories in 2 minutes",
    description: "Micro-dramas in Hindi, Tamil and Telugu. First 10 episodes free. No ads.",
  },
  appleWebApp: { capable: true, title: "Katha" },
  // No `apple-itunes-app` banner: the App Store id 0000000000 was a stand-in,
  // and a smart banner pointing at a listing that does not exist is a lie the
  // browser renders on our behalf. It goes back the day the app ships.
};

export const viewport: Viewport = {
  themeColor: "#0F0B09",
  // Dark-only by design (there is no light palette): declared so form
  // controls, scrollbars and the canvas match instead of flashing white.
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${display.variable} ${wordmark.variable}`}>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <WalletProvider>
          <SiteHeader />
          <main id="main">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}

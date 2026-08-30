import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter, JetBrains_Mono } from "next/font/google";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
// Not optional, and not cosmetic. The rule that matters is
// `html.lenis, html.lenis body { height: auto }`.
//
// <html> carries `h-full` below, so without this stylesheet the documentElement
// border box is pinned to the viewport. Lenis recomputes its scroll limit from
// a ResizeObserver on that box — which therefore never fires when the content
// grows. On a hard load Lenis reads the right scrollHeight and everything
// looks fine; on a CLIENT-SIDE navigation from a short page to a tall one it
// keeps the old limit, and a limit of 0 means it preventDefault()s every wheel
// event. /vault fits one viewport, so clicking any card into /vault/<slug>
// produced a page that could not be scrolled at all.
//
// bin/vendor.mjs already copies this file into site/ for the static grid; the
// React app was the one surface missing it.
import "lenis/dist/lenis.css";
import "./globals.css";

/**
 * Display face. DESIGN.md specifies GT Walsheim Medium, which is Grilli Type
 * and commercially licensed — not something that can ship on a public domain
 * without paying for it. General Sans (Fontshare, free for commercial use) is
 * the closest geometric-humanist substitute: same warm, slightly rounded
 * terminals, and it survives the -0.05em tracking the design leans on.
 *
 * Self-hosted rather than pulled from Fontshare's CDN so there is no
 * third-party request in the critical path.
 */
const generalSans = localFont({
  src: [
    { path: "../fonts/GeneralSans-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/GeneralSans-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/GeneralSans-600.woff2", weight: "600", style: "normal" },
    { path: "../fonts/GeneralSans-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-general-sans",
  display: "swap",
  preload: true,
});

/**
 * Body face, verbatim from DESIGN.md. The character variants that give it its
 * voice (cv01/05/09/11, ss03, ss07, dlig) are applied in globals.css.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * Mono face. Used only on the marketing landing — the brand wordmark, the code
 * bundle, the small technical labels. Self-hosted by next/font at build so it
 * adds no third-party request, and exposed as --font-jetbrains-mono for the one
 * page (landing.css) that maps --font-mono onto it. Nothing else references it.
 */
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "morgue",
    template: "%s · morgue",
  },
  description:
    "A reference collection of UI components and web animations, captured deterministically.",
  metadataBase: new URL("https://morgue.clupai.com"),
  // All derived from assets/icon-src.png by `pnpm icon`. favicon.ico is picked
  // up from src/app/ by convention and is not listed here; these are the ones
  // that need declaring. og.png is 1200x630 with the mark centred rather than
  // stretched, because social cards crop the edges.
  icons: {
    apple: "/apple-touch-icon.png",
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
  openGraph: {
    title: "morgue",
    description:
      "A reference collection of UI components and web animations, captured deterministically.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${generalSans.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="bg-canvas text-ink min-h-full flex flex-col">
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}

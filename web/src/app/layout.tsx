import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter } from "next/font/google";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
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

export const metadata: Metadata = {
  title: {
    default: "morgue",
    template: "%s · morgue",
  },
  description:
    "A reference collection of UI components and web animations, captured deterministically.",
  metadataBase: new URL("https://morgue.clupai.com"),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${generalSans.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="bg-canvas text-ink min-h-full flex flex-col">
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}

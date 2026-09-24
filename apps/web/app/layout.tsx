import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AnnouncementBar, BottomNav, SiteFooter, SiteHeader } from "@/components/site-chrome";
import { StoreHydration, themeBootstrapScript } from "@/lib/store/hydration";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: {
    default: "Bale Drop — Trusted Okirika, Split Bales",
    template: "%s | Bale Drop",
  },
  description:
    "Buy verified Okirika bales and single pieces with escrow protection. Split full bales with other buyers and pay per slot.",
  applicationName: "Bale Drop",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Bale Drop",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
  // Low-end Android is the target device (UX research §7): system fonts, no
  // external font/script requests on the critical path.
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1a16" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint — no light→dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className={cn("min-h-screen bg-background font-sans text-foreground antialiased")}>
        <StoreHydration />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <AnnouncementBar />
        <SiteHeader />
        <main id="main" className="pb-28 md:pb-0">
          {children}
        </main>
        <SiteFooter />
        <BottomNav />
      </body>
    </html>
  );
}

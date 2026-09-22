import type { Metadata } from "next";
import "./globals.css";
import { AnnouncementBar, BottomNav, SiteFooter, SiteHeader } from "@/components/site-chrome";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: {
    default: "Bale Drop — Trusted Okirika, Split Bales",
    template: "%s | Bale Drop",
  },
  description:
    "Buy verified Okirika bales and single pieces with escrow protection. Split full bales with other buyers and pay per slot.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={cn("min-h-screen bg-background font-sans text-foreground antialiased")}>
        <AnnouncementBar />
        <SiteHeader />
        <main className="pb-24 md:pb-0">{children}</main>
        <SiteFooter />
        <BottomNav />
      </body>
    </html>
  );
}

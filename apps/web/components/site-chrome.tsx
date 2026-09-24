"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  Heart,
  Home,
  MapPin,
  Package,
  Search,
  ShieldCheck,
  ShoppingBag,
  Star,
  Store,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthButton } from "@/components/auth-button";
import { CartCount } from "@/components/cart-count";
import { CityPicker } from "@/components/city-picker";
import { NotificationBell } from "@/components/notification-bell";
import { SearchField } from "@/components/search-field";
import { ThemeToggle } from "@/components/theme-toggle";
import { WishlistCount } from "@/components/wishlist-count";
import { cn } from "@/lib/utils";

/* ---------- Brand ---------- */

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="Bale Drop home">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow">
        <Package className="h-5 w-5" />
      </span>
      {!compact && (
        <span className="text-lg font-extrabold tracking-tight">
          Bale<span className="text-primary">Drop</span>
        </span>
      )}
    </Link>
  );
}

/* ---------- Announcement + Header ---------- */

export function AnnouncementBar() {
  return (
    <div className="bg-amber-400 text-amber-950">
      <div className="container flex items-center justify-center gap-2 py-1.5 text-center text-[13px] font-semibold">
        <Truck className="h-4 w-4 shrink-0" />
        <span className="truncate">Launch promo: subsidized delivery in Lagos, Abuja, PH &amp; Kano</span>
      </div>
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="container flex h-16 items-center gap-3">
        <Logo />
        {/* Desktop search — real /search route (was a dead anchor) */}
        <div className="mx-auto hidden w-full max-w-xl flex-1 md:block">
          <SearchField />
        </div>
        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          <CityPicker />
          <Badge variant="verified" className="hidden xl:inline-flex">
            <ShieldCheck /> Escrow protected
          </Badge>
          <Button variant="ghost" size="icon" aria-label="Wishlist" className="relative hidden sm:inline-flex" asChild>
            <Link href="/wishlist">
              <Heart className="h-5 w-5" />
              <WishlistCount />
            </Link>
          </Button>
          <NotificationBell />
          <ThemeToggle />
          <Button variant="ghost" size="icon" aria-label="Cart" className="relative" asChild>
            <Link href="/cart">
              <ShoppingBag className="h-5 w-5" />
              <CartCount />
            </Link>
          </Button>
          <Button size="sm" className="hidden sm:inline-flex" asChild>
            <Link href="/sell">
              <Store /> Sell
            </Link>
          </Button>
          <AuthButton />
        </div>
      </div>
      {/* Mobile search row */}
      <div className="container pb-3 md:hidden">
        <SearchField placeholder="Search bales, sneakers, vintage…" />
      </div>
    </header>
  );
}

/* ---------- Mobile bottom nav (thumb zone) ---------- */

/**
 * Bottom nav = the four actions a buyer needs with a thumb: browse, search the
 * catalog, open the cart, track orders. "Splits" left the nav because it was an
 * anchor (never active, never a real destination) — /search?kind=bale replaces
 * it as a genuine landing page. "Sell" lives in the header + footer.
 */
const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/cart", label: "Cart", icon: ShoppingBag },
  { href: "/orders", label: "Orders", icon: Package },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="grid grid-cols-4">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <span className="relative">
                <item.icon className="h-5 w-5" />
                {item.href === "/cart" && <CartCount />}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ---------- Trust strip ---------- */

const TRUST = [
  { icon: ShieldCheck, title: "Escrow protected", sub: "Vendor paid only after delivery" },
  { icon: BadgeCheck, title: "Verified vendors", sub: "ID + shop inspection" },
  { icon: Truck, title: "Tracked delivery", sub: "Door-to-door in 4 cities" },
  { icon: Star, title: "Honest reviews", sub: "Only from real buyers" },
] as const;

export function TrustStrip() {
  return (
    <section aria-label="Why trust Bale Drop" className="border-y bg-card">
      <div className="container grid grid-cols-2 gap-4 py-5 lg:grid-cols-4">
        {TRUST.map((t) => (
          <div key={t.title} className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <t.icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-bold">{t.title}</span>
              <span className="block text-[13px] text-muted-foreground">{t.sub}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- Footer ---------- */

export function SiteFooter() {
  return (
    <footer className="border-t bg-card">
      <div className="container grid gap-8 py-10 md:grid-cols-4">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            The most trusted Okirika commerce experience in Nigeria. Verified listings, secure escrow
            payments, tracked delivery.
          </p>
          <div className="mt-3 flex gap-2">
            <Badge variant="verified">
              <ShieldCheck /> Escrow
            </Badge>
            <Badge variant="outline">Paystack secured</Badge>
          </div>
        </div>
        <nav aria-label="Shop">
          <h3 className="text-sm font-bold">Shop</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link href="/search?kind=bale" className="hover:text-foreground">Live bale splits</Link></li>
            <li><Link href="/search?sort=newest" className="hover:text-foreground">New arrivals</Link></li>
            <li><Link href="/#vendors" className="hover:text-foreground">Verified vendors</Link></li>
            <li><Link href="/orders" className="hover:text-foreground">Track orders</Link></li>
          </ul>
        </nav>
        <nav aria-label="Sell">
          <h3 className="text-sm font-bold">Sell</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link href="/sell" className="hover:text-foreground">Become a vendor</Link></li>
            <li><Link href="/sell" className="hover:text-foreground">Verification guide</Link></li>
            <li><Link href="/vendor" className="hover:text-foreground">Seller dashboard</Link></li>
            <li><Link href="/account" className="hover:text-foreground">Account settings</Link></li>
          </ul>
        </nav>
        <nav aria-label="Support">
          <h3 className="text-sm font-bold">Support</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link href="/support" className="hover:text-foreground">Contact support</Link></li>
            <li><Link href="/policies/refunds" className="hover:text-foreground">Refunds &amp; disputes</Link></li>
            <li><Link href="/policies/delivery" className="hover:text-foreground">Delivery &amp; fees</Link></li>
            <li><Link href="/wishlist" className="hover:text-foreground">Saved items</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t">
        <div className="container flex flex-col items-center justify-between gap-2 py-4 text-[13px] text-muted-foreground sm:flex-row">
          <span>© 2026 Bale Drop. All rights reserved.</span>
          <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <Link href="/policies" className="hover:text-foreground">Policies</Link>
            <Link href="/policies/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/policies/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/policies/refunds" className="hover:text-foreground">Refunds</Link>
            <Link href="/support" className="hover:text-foreground">Support</Link>
          </nav>
          <span>Lagos • Abuja • Port Harcourt • Kano</span>
        </div>
      </div>
    </footer>
  );
}

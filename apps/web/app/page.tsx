import Link from "next/link";
import { ArrowRight, MapPin, ShieldCheck, Store, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrustStrip } from "@/components/site-chrome";
import {
  BaleSplitCard,
  CategoryPills,
  EscrowSteps,
  ProductCard,
  SectionHeader,
  VendorCard,
} from "@/components/commerce";
import { RecentlyViewedRail } from "@/components/recently-viewed";
import { HomeTracker } from "@/components/home-tracker";
import { getHomeData } from "@/lib/data";
import { slotsLeft } from "@bale-drop/database";

/** Homepage — live Supabase data with mock fallback (see lib/data.ts). */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { bales, products, vendors } = await getHomeData();
  const featured = [...bales].sort((a, b) => slotsLeft(a.bale) - slotsLeft(b.bale))[0];
  const firstProductByVendor = new Map(products.map((p) => [p.vendor.id, p.product.id] as const));

  return (
    <div className="animate-fade-up">
      <HomeTracker />
      {/* ---------- HERO ---------- */}
      <section className="container grid gap-8 py-8 md:py-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div>
          <Badge variant="amber" className="mb-4">
            <Zap /> Live now in 4 cities
          </Badge>
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight md:text-5xl">
            Okirika, <span className="text-primary">without stories.</span>
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg">
            Verified bales and single pieces from inspected vendors. Pay into escrow, track
            delivery, and only release money when you confirm. Or{" "}
            <b className="text-foreground">split a full bale</b> with other buyers and pay per slot.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link href="/search?kind=bale">
                Browse live splits <ArrowRight />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/sell">
                <Store /> Become a vendor
              </Link>
            </Button>
          </div>
          <dl className="mt-8 grid max-w-md grid-cols-3 gap-4 border-t pt-5">
            {[
              ["100%", "escrow protected"],
              ["4", "launch cities"],
              ["48hrs", "confirm window"],
            ].map(([v, l]) => (
              <div key={l}>
                <dt className="text-2xl font-extrabold tabular-nums">{v}</dt>
                <dd className="text-[13px] text-muted-foreground">{l}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Spotlight: the split closest to filling = urgency above the fold */}
        {featured && (
          <div className="relative">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-bold">
                <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                </span>
                Filling fast — {slotsLeft(featured.bale)} slot{slotsLeft(featured.bale) === 1 ? "" : "s"} left
              </p>
              <Link href="/search?kind=bale" className="text-sm font-semibold text-primary hover:underline">
                All splits
              </Link>
            </div>
            <BaleSplitCard bale={featured.bale} product={featured.product} vendor={featured.vendor} featured />
          </div>
        )}
      </section>

      <TrustStrip />

      {/* ---------- LIVE SPLITS ---------- */}
      <section id="splits" className="container scroll-mt-24 py-10">
        <SectionHeader
          title="Live bale splits"
          sub="Claim a slot. If the bale doesn't fill in time, everyone is auto-refunded."
          href="/search?kind=bale"
          linkLabel="See all splits"
        />
        {bales.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="font-bold">No splits are open right now</p>
            <p className="mt-1 text-sm text-muted-foreground">
              New bales open every day. Browse single pieces in the meantime, or ask a vendor to start a split.
            </p>
            <Button className="mt-4" asChild>
              <Link href="/search">Browse all listings</Link>
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {bales.map((b) => (
              <BaleSplitCard key={b.bale.id} bale={b.bale} product={b.product} vendor={b.vendor} />
            ))}
          </div>
        )}
      </section>

      {/* ---------- BROWSE ---------- */}
      <section id="new" className="container scroll-mt-24 py-6">
        <SectionHeader
          title="Shop by category"
          sub="Filter by city, grade and price — every listing is escrow protected."
          href="/search"
          linkLabel="Open search"
        />
        <CategoryPills />
        {products.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="font-bold">No listings are live yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Vendors are being verified in your city.</p>
            <Button className="mt-4" asChild>
              <Link href="/sell">Apply to sell</Link>
            </Button>
          </Card>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.product.id} product={p.product} vendor={p.vendor} />
            ))}
          </div>
        )}
        <RecentlyViewedRail limit={6} />
      </section>

      {/* ---------- VENDORS ---------- */}
      <section id="vendors" className="container scroll-mt-24 py-10">
        <SectionHeader
          title="Featured verified vendors"
          sub="ID-verified shops. Inspected badge = physically visited by our team."
          href="/sell"
          linkLabel="Join as vendor"
        />
        <div className="grid gap-4 md:grid-cols-2">
          {vendors.slice(0, 4).map((v) => (
            <VendorCard key={v.id} vendor={v} productId={firstProductByVendor.get(v.id)} />
          ))}
        </div>
      </section>

      {/* ---------- ESCROW ---------- */}
      <section id="escrow" className="container scroll-mt-24 py-6 pb-12">
        <SectionHeader
          title="Your money is never at risk"
          sub="Every naira passes through escrow. No stories, no 'send receipt on WhatsApp'."
        />
        <EscrowSteps />
        <div className="mt-6 flex flex-col items-start gap-3 rounded-2xl bg-primary p-6 text-primary-foreground md:flex-row md:items-center">
          <ShieldCheck className="h-10 w-10 shrink-0" />
          <div className="flex-1">
            <p className="font-bold">Wrong grade or no delivery? Get refunded.</p>
            <p className="text-sm opacity-90">
              Open a dispute with photo evidence. Payouts pause until it&apos;s resolved.
            </p>
          </div>
          <Button variant="accent" asChild>
            <Link href="/orders">
              <MapPin /> Track an order
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

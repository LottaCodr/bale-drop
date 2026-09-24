import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, MapPin, MessageSquare, Package, ShieldCheck, Star, Store, Truck } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Stars } from "@/components/ui/stars";
import { BaleSplitCard, ProductCard, SectionHeader, VerifiedMark } from "@/components/commerce";
import { getVendorStorefront } from "@/lib/data";
import { naira } from "@/lib/format";

/**
 * Public vendor storefront.
 *
 * Vendor cards previously had nowhere real to send a buyer ("Shop" went to a
 * single listing), so a discovered shop could not be browsed — a discovery and
 * liquidity gap. This is that destination: shop stats, trust signals, live
 * splits, the full catalog and the shop's reviews.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const store = await getVendorStorefront(id);
  if (!store) return { title: "Vendor" };
  return {
    title: `${store.vendor.shopName} — ${store.vendor.city}`,
    description: `${store.vendor.shopName} on Bale Drop: ${store.products.length} listings, ${store.vendor.sales.toLocaleString()} sales and escrow-protected delivery.`,
  };
}

export default async function VendorStorefrontPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getVendorStorefront(id);
  if (!store) notFound();
  const { vendor, products, splits, reviews } = store;
  const cheapest = products.reduce((min, entry) => Math.min(min, entry.product.price), Number.POSITIVE_INFINITY);
  const repeatReviews = reviews.reviews.slice(0, 4);

  return (
    <div className="container animate-fade-up py-6">
      {/* Shop header */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar initials={vendor.initials} hue={vendor.hue} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight">{vendor.shopName}</h1>
              <VerifiedMark vendor={vendor} />
              {vendor.inspected && <Badge variant="verified">Inspected shop</Badge>}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {vendor.city}
              </span>
              <span className="flex items-center gap-1">
                <Stars value={vendor.rating} /> <b className="text-foreground">{vendor.rating}</b> ({vendor.reviews}{" "}
                reviews)
              </span>
              <span>{vendor.sales.toLocaleString()} sales</span>
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5" /> responds {vendor.responseTime}
              </span>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto">
            <Button asChild>
              <Link href={`/search?vendor=${encodeURIComponent(vendor.id)}`}>
                <Store /> Browse all listings
              </Link>
            </Button>
            {products[0] && (
              <Button variant="outline" asChild>
                <Link href={`/listing/${products[0].product.id}`}>Latest listing</Link>
              </Button>
            )}
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 border-t pt-4 text-sm md:grid-cols-4">
          {[
            ["Listings", String(products.length)],
            ["Live splits", String(splits.length)],
            ["From", Number.isFinite(cheapest) ? naira(cheapest) : "—"],
            ["Verification", vendor.inspected ? "Inspected + ID" : vendor.verified ? "ID verified" : "Pending"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-muted/60 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* Trust strip */}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {[
          { icon: ShieldCheck, title: "Escrow on every order", body: "This vendor is paid only after you confirm delivery." },
          { icon: Truck, title: "Tracked delivery", body: `Ships from ${vendor.city} to all launch cities in 2–4 days.` },
          { icon: BadgeCheck, title: "Verified identity", body: vendor.inspected ? "Shop physically inspected by our team." : "Government ID and bank account verified." },
        ].map((item) => (
          <Card key={item.title} className="flex items-start gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <item.icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-bold">{item.title}</span>
              <span className="block text-[13px] text-muted-foreground">{item.body}</span>
            </span>
          </Card>
        ))}
      </div>

      {splits.length > 0 && (
        <section className="mt-8">
          <SectionHeader
            title="Live bale splits from this shop"
            sub="Join with other buyers and pay per slot — auto-refund if it fills short."
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {splits.map((entry) => (
              <BaleSplitCard key={entry.bale.id} bale={entry.bale} product={entry.product} vendor={entry.vendor} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <SectionHeader
          title={`All listings (${products.length})`}
          sub="Every item is grade-verified before it ships."
          href={`/search?vendor=${encodeURIComponent(vendor.id)}`}
          linkLabel="Open in search"
        />
        {products.length === 0 ? (
          <Card className="p-8 text-center">
            <Package className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="mt-2 font-bold">This shop has no active listings right now</p>
            <p className="mt-1 text-sm text-muted-foreground">Follow the shop or browse other verified vendors.</p>
            <Button className="mt-4" asChild>
              <Link href="/search">Browse all listings</Link>
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            {products.map((entry) => (
              <ProductCard key={entry.product.id} product={entry.product} vendor={entry.vendor} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <SectionHeader
          title="What buyers say"
          sub={reviews.count > 0 ? `${reviews.average} average from ${reviews.count} verified orders.` : "Reviews come only from delivered orders."}
        />
        {repeatReviews.length === 0 ? (
          <Card className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
            <Star className="h-4 w-4 text-primary" /> No reviews yet — this shop is new to Bale Drop.
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {repeatReviews.map((review) => (
              <Card key={review.id} className="p-4">
                <div className="flex items-center gap-2.5">
                  <Avatar initials={review.initials} hue={review.hue} size="sm" />
                  <div>
                    <p className="text-sm font-bold">{review.author}</p>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Stars value={review.rating} /> {new Date(review.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })} • Verified purchase
                    </p>
                  </div>
                </div>
                {review.body && <p className="mt-2.5 text-sm leading-relaxed">{review.body}</p>}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

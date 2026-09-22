import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChevronRight, MapPin, ShieldCheck, Truck } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Stars } from "@/components/ui/stars";
import { BaleWidget } from "@/components/bale-widget";
import {
  EscrowNote,
  GradeBadge,
  ProductArt,
  ProductCard,
  SectionHeader,
  VendorCard,
  VerifiedMark,
} from "@/components/commerce";
import { FavoriteButton } from "@/components/favorite-button";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { naira } from "@/lib/format";
import { getListingData } from "@/lib/data";
import { slotPrice } from "@bale-drop/database";

/** Listing detail — live Supabase data with mock fallback. Always fresh (no stale splits). */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const data = await getListingData(id);
  return { title: data ? data.product.title : "Listing" };
}

const REVIEWS = [
  {
    name: "Chiamaka O.",
    initials: "CO",
    hue: 280,
    rating: 5,
    date: "Sep 10, 2026",
    text: "Bale exactly as described — Grade A, no stories. Escrow made me confident to pay full amount upfront.",
  },
  {
    name: "Ibrahim M.",
    initials: "IM",
    hue: 210,
    rating: 4,
    date: "Aug 28, 2026",
    text: "Delivery to Kano took 3 days, tracking worked throughout. One piece had a small stain, vendor gave partial refund fast.",
  },
];

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getListingData(id);
  if (!data) notFound();
  const { product, vendor, bale, related } = data;

  return (
    <div className="container animate-fade-up py-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-[13px] text-muted-foreground">
        <Link href="/" className="hover:text-foreground">Home</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link href="/#new" className="hover:text-foreground">{product.category}</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="truncate font-medium text-foreground">{product.title}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Gallery */}
        <div>
          <div className="relative overflow-hidden rounded-2xl border">
            <ProductArt hue={product.hue} category={product.category} className="aspect-[4/3] w-full" iconClassName="h-28 w-28" />
            <div className="absolute left-3 top-3 flex gap-1.5">
              <GradeBadge grade={product.grade} />
              {product.tag && <Badge variant="amber">{product.tag}</Badge>}
              {bale && <Badge variant="live">Split live</Badge>}
            </div>
            <FavoriteButton className="absolute right-3 top-3" />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-3" aria-hidden="true">
            {[0, 40, 80, 120].map((shift) => (
              <div key={shift} className="overflow-hidden rounded-xl border">
                <ProductArt hue={(product.hue + shift) % 360} category={product.category} className="aspect-square w-full" iconClassName="h-8 w-8" />
              </div>
            ))}
          </div>

          {/* Details (desktop: under gallery) */}
          <Card className="mt-4 hidden p-5 lg:block">
            <h2 className="font-bold">Bale details</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              {[
                ["Grade", `Grade ${product.grade} (verified)`],
                ["Weight", bale?.bale.weight ?? "—"],
                ["Approx. pieces", bale?.bale.pieces ?? product.pieces ?? "Single item"],
                ["Ships from", product.city],
                ["Category", product.category],
                ["Listing ID", `BD-${product.id.slice(0, 8).toUpperCase()}`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-muted/60 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        {/* Buy panel */}
        <div className="lg:sticky lg:top-32 lg:self-start">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Stars value={product.rating} />
            <b className="text-foreground">{product.rating}</b>
            <span>• {product.sold} sold</span>
            <span className="ml-auto flex items-center gap-0.5">
              <MapPin className="h-3.5 w-3.5" /> {product.city}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-extrabold leading-tight tracking-tight md:text-3xl">
            {product.title}
          </h1>
          <p className="mt-2 flex items-center gap-1.5 text-sm">
            <Avatar initials={vendor.initials} hue={vendor.hue} size="xs" />
            <span className="font-semibold">{vendor.shopName}</span>
            <VerifiedMark vendor={vendor} />
            <span className="text-muted-foreground">• responds {vendor.responseTime}</span>
          </p>

          <Separator className="my-4" />

          {bale ? (
            <BaleWidget initialBale={bale.bale} product={product} vendor={vendor} />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold tabular-nums">{naira(product.price)}</span>
                {product.oldPrice && (
                  <>
                    <span className="text-muted-foreground line-through tabular-nums">{naira(product.oldPrice)}</span>
                    <Badge variant="amber">Save {naira(product.oldPrice - product.price)}</Badge>
                  </>
                )}
              </div>
              <EscrowNote />
              <div className="grid grid-cols-2 gap-3">
                <AddToCartButton productId={product.id} />
                <Button size="lg" asChild>
                  <Link href={`/checkout?product=${encodeURIComponent(product.id)}`}>Buy now</Link>
                </Button>
              </div>
            </div>
          )}

          {/* Delivery estimate */}
          <Card className="mt-4 flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Truck className="h-5 w-5" />
            </span>
            <div className="text-sm">
              <p className="font-bold">2–4 days to Lagos • {naira(2500)}</p>
              <p className="text-muted-foreground">Tracked door-to-door • Launch subsidy applied</p>
            </div>
          </Card>

          <div className="mt-3 flex items-start gap-2 text-[13px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              Covered by Bale Drop escrow. {bale ? "Auto-refunded if the split doesn't fill." : "Full refund if item isn't as described."}
            </p>
          </div>
        </div>
      </div>

      {/* Mobile details */}
      <Card className="mt-6 p-5 lg:hidden">
        <h2 className="font-bold">Bale details</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          {[
            ["Grade", `Grade ${product.grade}`],
            ["Weight", bale?.bale.weight ?? "—"],
            ["Approx. pieces", bale?.bale.pieces ?? "Single item"],
            ["Ships from", product.city],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-muted/60 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* Vendor */}
      <div className="mt-6">
        <SectionHeader title="About the vendor" />
        <VendorCard vendor={vendor} productId={product.id} />
      </div>

      {/* Reviews */}
      <div className="mt-8">
        <SectionHeader title="Buyer reviews" sub="Only buyers with delivered orders can review." />
        <div className="grid gap-4 md:grid-cols-2">
          {REVIEWS.map((r) => (
            <Card key={r.name} className="p-4">
              <div className="flex items-center gap-2.5">
                <Avatar initials={r.initials} hue={r.hue} size="sm" />
                <div>
                  <p className="text-sm font-bold">{r.name}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Stars value={r.rating} /> {r.date} • Verified purchase
                  </p>
                </div>
              </div>
              <p className="mt-2.5 text-sm leading-relaxed">{r.text}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* Related */}
      <div className="mt-8 pb-4">
        <SectionHeader title="You may also like" />
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          {related.map((p) => (
            <ProductCard key={p.product.id} product={p.product} vendor={p.vendor} />
          ))}
        </div>
      </div>

      {/* Sticky mobile buy bar (sits above bottom nav) */}
      <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-background/95 backdrop-blur md:hidden">
        <div className="container flex items-center gap-3 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-lg font-extrabold tabular-nums">
              {bale ? naira(slotPrice(bale.bale)) : naira(product.price)}
            </div>
            <div className="truncate text-xs text-muted-foreground">{bale ? "per slot" : vendor.shopName}</div>
          </div>
          {bale ? (
            <Button variant="accent" className="ml-auto shrink-0" asChild>
              <a href="#book">Claim slot</a>
            </Button>
          ) : (
            <Button className="ml-auto shrink-0" asChild>
              <Link href={`/checkout?product=${encodeURIComponent(product.id)}`}>Buy now</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

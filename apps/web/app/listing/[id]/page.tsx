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
import { BuyPanel } from "@/components/buy-panel";
import { RecentlyViewedRail } from "@/components/recently-viewed";
import { ShareButton } from "@/components/share-button";
import { ViewTracker } from "@/components/view-tracker";
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
import { naira } from "@/lib/format";
import { getListingData, getProductReviews } from "@/lib/data";
import { slotPrice } from "@bale-drop/database";

/** Listing detail — live Supabase data with mock fallback. Always fresh (no stale splits). */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const data = await getListingData(id);
  if (!data) return { title: "Listing" };
  return {
    title: data.product.title,
    description:
      data.product.description ??
      `${data.product.title} from ${data.vendor.shopName} (${data.vendor.city}). Escrow protected, tracked delivery.`,
    openGraph: {
      title: data.product.title,
      description: `Grade ${data.product.grade} • ${naira(data.product.price)} • ${data.vendor.shopName}`,
    },
  };
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getListingData(id);
  if (!data) notFound();
  const { product, vendor, bale, related } = data;
  const reviews = await getProductReviews(product.id);

  const rating = reviews.count > 0 ? reviews.average : product.rating;
  const ratingCount = reviews.count > 0 ? reviews.count : product.sold;
  const perSlot = bale ? slotPrice(bale.bale) : product.price;

  return (
    <div className="container animate-fade-up py-6">
      <ViewTracker product={product} vendor={vendor} />

      {/* Breadcrumb — category now resolves to real search results */}
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-[13px] text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Home
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link href={`/search?category=${encodeURIComponent(product.category)}`} className="hover:text-foreground">
          {product.category}
        </Link>
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
            <FavoriteButton product={product} vendor={vendor} className="absolute right-3 top-3" />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-3" aria-hidden="true">
            {[0, 40, 80, 120].map((shift) => (
              <div key={shift} className="overflow-hidden rounded-xl border">
                <ProductArt hue={(product.hue + shift) % 360} category={product.category} className="aspect-square w-full" iconClassName="h-8 w-8" />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Photos are representative art in demo mode; vendors upload real bale photos in live mode.
          </p>

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
            {product.description && (
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{product.description}</p>
            )}
          </Card>
        </div>

        {/* Buy panel */}
        <div className="lg:sticky lg:top-32 lg:self-start">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Stars value={rating} />
            <b className="text-foreground">{rating}</b>
            <span>• {ratingCount} {reviews.count > 0 ? "reviews" : "sold"}</span>
            <span className="ml-auto flex items-center gap-0.5">
              <MapPin className="h-3.5 w-3.5" /> {product.city}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-extrabold leading-tight tracking-tight md:text-3xl">{product.title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
            <Avatar initials={vendor.initials} hue={vendor.hue} size="xs" />
            <Link href={`/vendor/${vendor.id}`} className="font-semibold hover:text-primary hover:underline">
              {vendor.shopName}
            </Link>
            <VerifiedMark vendor={vendor} />
            <span className="text-muted-foreground">• responds {vendor.responseTime}</span>
          </p>

          <Separator className="my-4" />

          {bale ? (
            <BaleWidget initialBale={bale.bale} product={product} vendor={vendor} />
          ) : (
            <BuyPanel product={product} vendor={vendor} />
          )}

          {bale && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ShareButton
                title={product.title}
                pricePerSlot={perSlot}
                slotsLeftCount={Math.max(0, bale.bale.splitCount - bale.bale.bookedCount)}
              />
            </div>
          )}

          {/* Delivery estimate */}
          <Card className="mt-4 flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Truck className="h-5 w-5" />
            </span>
            <div className="text-sm">
              <p className="font-bold">2–4 days • from {naira(2500)}</p>
              <p className="text-muted-foreground">
                Tracked door-to-door to Lagos, Abuja, PH &amp; Kano • Launch subsidy applied at checkout
              </p>
            </div>
          </Card>

          <div className="mt-3 flex items-start gap-2 text-[13px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              Covered by Bale Drop escrow.{" "}
              {bale ? "Auto-refunded if the split doesn't fill." : "Full refund if item isn't as described."}
            </p>
          </div>

          <div className="mt-4">
            <EscrowNote />
          </div>

          {/* Vendor quick card */}
          <div className="mt-4">
            <VendorCard vendor={vendor} />
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
        {product.description && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{product.description}</p>}
      </Card>

      {/* Reviews */}
      <div className="mt-8">
        <SectionHeader
          title="Buyer reviews"
          sub="Only buyers with delivered orders can review — no seeded praise."
        />
        {reviews.count === 0 ? (
          <Card className="p-6 text-center">
            <p className="font-bold">No reviews yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This is a new listing. Reviews appear here after buyers confirm delivery.
            </p>
          </Card>
        ) : (
          <>
            <Card className="mb-4 flex flex-wrap items-center gap-6 p-4">
              <div className="text-center">
                <p className="text-3xl font-extrabold tabular-nums">{reviews.average}</p>
                <Stars value={reviews.average} />
                <p className="mt-1 text-xs text-muted-foreground">
                  {reviews.count} review{reviews.count === 1 ? "" : "s"}
                </p>
              </div>
              <div className="min-w-48 flex-1">
                {([5, 4, 3, 2, 1] as const).map((star) => {
                  const count = reviews.distribution[star];
                  const pct = reviews.count ? Math.round((count / reviews.count) * 100) : 0;
                  return (
                    <div key={star} className="flex items-center gap-2 text-xs">
                      <span className="w-6 tabular-nums text-muted-foreground">{star}★</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="presentation">
                        <span className="block h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-8 text-right tabular-nums text-muted-foreground">{count}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
            <div className="grid gap-4 md:grid-cols-2">
              {reviews.reviews.slice(0, 6).map((review) => (
                <Card key={review.id} className="p-4">
                  <div className="flex items-center gap-2.5">
                    <Avatar initials={review.initials} hue={review.hue} size="sm" />
                    <div>
                      <p className="text-sm font-bold">{review.author}</p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Stars value={review.rating} />{" "}
                        {new Date(review.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })} • Verified purchase
                      </p>
                    </div>
                  </div>
                  {review.body && <p className="mt-2.5 text-sm leading-relaxed">{review.body}</p>}
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Related */}
      {related.length > 0 && (
        <div className="mt-8">
          <SectionHeader
            title="You may also like"
            href={`/search?category=${encodeURIComponent(product.category)}`}
            linkLabel={`More in ${product.category}`}
          />
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            {related.map((entry) => (
              <ProductCard key={entry.product.id} product={entry.product} vendor={entry.vendor} />
            ))}
          </div>
        </div>
      )}

      <RecentlyViewedRail excludeId={product.id} />

      {/* Sticky mobile buy bar (sits above bottom nav) */}
      <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-background/95 backdrop-blur md:hidden">
        <div className="container flex items-center gap-3 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-lg font-extrabold tabular-nums">{naira(perSlot)}</div>
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

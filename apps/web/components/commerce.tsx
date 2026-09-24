import Link from "next/link";
import {
  ArrowRight,
  Baby,
  BadgeCheck,
  Briefcase,
  ChevronRight,
  CreditCard,
  Footprints,
  Gem,
  LayoutGrid,
  MapPin,
  Package,
  ShieldCheck,
  Shirt,
  Sparkles,
  Truck,
  Users,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Stars } from "@/components/ui/stars";
import { CompactCountdown } from "@/components/countdown";
import { FavoriteButton } from "@/components/favorite-button";
import { naira } from "@/lib/format";
import { CATEGORIES } from "@/lib/taxonomy";
import {
  slotPrice,
  slotsLeft,
  type BaleListing,
  type Grade,
  type Product,
  type Vendor,
} from "@bale-drop/database";
import { cn } from "@/lib/utils";

/* ---------- Shared bits ---------- */

const CATEGORY_ICONS: Record<string, typeof Shirt> = {
  All: LayoutGrid,
  Bales: Package,
  Men: Shirt,
  Women: Sparkles,
  Kids: Baby,
  Shoes: Footprints,
  Bags: Briefcase,
  Vintage: Gem,
};

const GRADE_BADGE: Record<Grade, "gradeA" | "gradeB" | "gradeC"> = {
  A: "gradeA",
  B: "gradeB",
  C: "gradeC",
};

export function GradeBadge({ grade, className }: { grade: Grade; className?: string }) {
  return (
    <Badge variant={GRADE_BADGE[grade]} className={className}>
      Grade {grade}
    </Badge>
  );
}

/** Zero-network product art: gradient + category glyph. Replaced by Supabase Storage images in prod. */
export function ProductArt({
  hue,
  category,
  className,
  iconClassName,
}: {
  hue: number;
  category: string;
  className?: string;
  iconClassName?: string;
}) {
  const Icon = CATEGORY_ICONS[category] ?? Package;
  return (
    <div
      aria-hidden="true"
      className={cn("relative flex items-center justify-center overflow-hidden", className)}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 45% 92%), hsl(${(hue + 40) % 360} 50% 82%))`,
      }}
    >
      <div
        className="absolute inset-0 opacity-40"
        style={{ background: `radial-gradient(circle at 80% 10%, hsl(${hue} 60% 70% / 0.6), transparent 55%)` }}
      />
      <Icon className={cn("h-16 w-16 text-white drop-shadow-sm", iconClassName)} strokeWidth={1.25} />
    </div>
  );
}

export function VerifiedMark({ vendor, className }: { vendor: Vendor; className?: string }) {
  if (!vendor.verified) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <BadgeCheck className="h-4 w-4 fill-emerald-600 text-white" aria-label="Verified vendor" />
      {vendor.inspected && (
        <Badge variant="inspected" className="px-1.5">
          Inspected
        </Badge>
      )}
    </span>
  );
}

export function SectionHeader({
  title,
  sub,
  href,
  linkLabel = "See all",
}: {
  title: string;
  sub?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight md:text-2xl">{title}</h2>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {href && (
        <Button variant="ghost" size="sm" asChild className="shrink-0">
          <Link href={href}>
            {linkLabel} <ChevronRight />
          </Link>
        </Button>
      )}
    </div>
  );
}

/* ---------- Category pills ---------- */

export function CategoryPills() {
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="list" aria-label="Categories">
      {CATEGORIES.map((cat, i) => {
        const Icon = CATEGORY_ICONS[cat] ?? Package;
        const href = cat === "All" ? "/search" : `/search?category=${encodeURIComponent(cat)}`;
        return (
          <Link
            key={cat}
            role="listitem"
            href={href}
            aria-current={i === 0 ? "true" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition",
              i === 0
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card hover:border-primary/50"
            )}
          >
            <Icon className="h-4 w-4" />
            {cat}
          </Link>
        );
      })}
    </div>
  );
}

/* ---------- Product card (data props — works with live or mock data) ---------- */

export function ProductCard({ product, vendor }: { product: Product; vendor: Vendor }) {
  return (
    <Link
      href={`/listing/${product.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-card transition hover:-translate-y-0.5 hover:shadow-pop"
    >
      <div className="relative">
        <ProductArt hue={product.hue} category={product.category} className="aspect-[4/3] w-full" />
        <div className="absolute left-2.5 top-2.5 flex gap-1.5">
          <GradeBadge grade={product.grade} />
          {product.tag && <Badge variant="amber">{product.tag}</Badge>}
        </div>
        <FavoriteButton product={product} vendor={vendor} className="absolute right-2.5 top-2.5" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <p className="line-clamp-2 text-sm font-semibold leading-snug group-hover:text-primary">{product.title}</p>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Stars value={product.rating} />
          <span className="font-semibold text-foreground">{product.rating}</span>
          <span>• {product.sold} sold</span>
        </div>
        <div className="mt-auto flex items-baseline gap-2 pt-1">
          <span className="text-lg font-extrabold tabular-nums">{naira(product.price)}</span>
          {product.oldPrice && (
            <span className="text-[13px] text-muted-foreground line-through tabular-nums">{naira(product.oldPrice)}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <VerifiedMark vendor={vendor} />
          <span className="truncate font-medium">{vendor.shopName}</span>
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            <MapPin className="h-3 w-3" /> {product.city}
          </span>
        </div>
      </div>
    </Link>
  );
}

/* ---------- Bale Split card (hero commerce unit) ---------- */

export function BaleSplitCard({
  bale,
  product,
  vendor,
  featured = false,
}: {
  bale: BaleListing;
  product: Product;
  vendor: Vendor;
  featured?: boolean;
}) {
  const pct = Math.round((bale.bookedCount / bale.splitCount) * 100);
  const left = slotsLeft(bale);

  return (
    <Link
      href={`/listing/${product.id}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-card transition hover:-translate-y-0.5 hover:shadow-pop",
        featured && "border-primary/40 ring-1 ring-primary/20"
      )}
    >
      <div className="relative">
        <ProductArt hue={product.hue} category={product.category} className="aspect-[16/8] w-full" iconClassName="h-20 w-20" />
        <div className="absolute left-3 top-3 flex gap-1.5">
          <Badge variant="live">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            LIVE SPLIT
          </Badge>
          <GradeBadge grade={product.grade} />
        </div>
        <div className="absolute right-3 top-3 rounded-full bg-background/90 px-2.5 py-1 backdrop-blur">
          <CompactCountdown expiresAt={bale.expiresAt} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="line-clamp-2 font-bold leading-snug group-hover:text-primary">{product.title}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Avatar initials={vendor.initials} hue={vendor.hue} size="xs" />
            <span className="font-medium text-foreground">{vendor.shopName}</span>
            <VerifiedMark vendor={vendor} />
          </p>
        </div>

        <div>
          <Progress value={pct} indicatorClassName={left <= 2 ? "bg-red-500" : left <= 4 ? "bg-amber-500" : undefined} />
          <div className="mt-1.5 flex items-center justify-between text-[13px]">
            <span className="flex items-center gap-1 font-semibold">
              <Users className="h-3.5 w-3.5 text-primary" />
              {bale.bookedCount}/{bale.splitCount} slots claimed
            </span>
            <span className={cn("font-bold", left <= 2 ? "text-red-600" : "text-amber-600")}>
              {left} left
            </span>
          </div>
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 border-t pt-3">
          <div>
            <div className="text-xl font-extrabold tabular-nums text-primary">{naira(slotPrice(bale))}</div>
            <div className="text-xs text-muted-foreground">
              per slot • {naira(bale.totalAmount)} total
            </div>
          </div>
          <Button size="sm" className="shrink-0">
            Claim slot <ArrowRight />
          </Button>
        </div>
      </div>
    </Link>
  );
}

/* ---------- Vendor card ---------- */

export function VendorCard({ vendor, productId }: { vendor: Vendor; productId?: string }) {
  return (
    <Card className="flex items-center gap-4 p-4">
      <Avatar initials={vendor.initials} hue={vendor.hue} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-bold">
          <span className="truncate">{vendor.shopName}</span>
          <VerifiedMark vendor={vendor} />
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
          <span className="flex items-center gap-0.5">
            <MapPin className="h-3 w-3" /> {vendor.city}
          </span>
          <span className="flex items-center gap-1">
            <Stars value={vendor.rating} /> <b className="text-foreground">{vendor.rating}</b> ({vendor.reviews})
          </span>
          <span>{vendor.sales.toLocaleString()} sales</span>
        </div>
      </div>
      <span className="flex shrink-0 flex-col gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/vendor/${vendor.id}`}>Visit shop</Link>
        </Button>
        {productId && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/listing/${productId}`}>Latest listing</Link>
          </Button>
        )}
      </span>
    </Card>
  );
}

/* ---------- Escrow explainer ---------- */

const ESCROW_STEPS = [
  {
    icon: CreditCard,
    step: "Step 1",
    title: "You pay into escrow",
    body: "Money leaves your account but is held by Bale Drop — never sent straight to the vendor.",
  },
  {
    icon: Truck,
    step: "Step 2",
    title: "Vendor ships, you track",
    body: "Live tracking on every order. Confirm delivery in the app when your bale arrives.",
  },
  {
    icon: ShieldCheck,
    step: "Step 3",
    title: "Money is released",
    body: "Vendor gets paid only after you confirm — or auto-release 48hrs after delivery. Disputes pause payout.",
  },
] as const;

export function EscrowSteps() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {ESCROW_STEPS.map((s) => (
        <Card key={s.step} className="p-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <s.icon className="h-5 w-5" />
          </span>
          <p className="mt-3 text-xs font-bold uppercase tracking-wider text-primary">{s.step}</p>
          <p className="mt-1 font-bold">{s.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
        </Card>
      ))}
    </div>
  );
}

/** Compact escrow reassurance for checkout / product pages. */
export function EscrowNote({ className }: { className?: string }) {
  return (
    <Card className={cn("border-primary/30 bg-primary/5 p-4", className)}>
      <CardContent className="flex items-start gap-3 p-0">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <p className="text-sm leading-relaxed">
          <b>Escrow protected.</b> Your payment is held by Bale Drop and released to the vendor only
          after you confirm delivery. Wrong grade or no delivery? Get refunded.
        </p>
      </CardContent>
    </Card>
  );
}

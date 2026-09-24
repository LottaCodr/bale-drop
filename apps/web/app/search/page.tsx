import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Filter, Search as SearchIcon, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BaleSplitCard, ProductCard, SectionHeader, VendorCard } from "@/components/commerce";
import { RecentlyViewedRail } from "@/components/recently-viewed";
import { SearchTracker } from "@/components/search-tracker";
import { searchCatalog } from "@/lib/data";
import { CATEGORIES, CITIES, GRADES, SORT_LABELS, SORTS, type SortKey } from "@/lib/taxonomy";
import {
  activeFilterCount,
  buildSearchHref,
  describeSearch,
  hasAnyFilter,
  parseSearchParams,
  type RawSearchParams,
} from "@/lib/search-params";
import { cn } from "@/lib/utils";

/**
 * `/search` — the discovery surface the storefront was missing.
 *
 * Before this page the header form pointed at `/#new` (a same-page anchor), the
 * category chips were decorative, and there was no way to filter by city, grade
 * or price. Filters are URL state, so every result set is shareable and the
 * back button behaves; the form works without JavaScript.
 */
export const dynamic = "force-dynamic";

const SORT_ORDER: SortKey[] = [...SORTS];

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}): Promise<Metadata> {
  const filters = parseSearchParams(await searchParams);
  const label = describeSearch(filters);
  return {
    title: hasAnyFilter(filters) ? `Search: ${label}` : "Shop verified okirika",
    description: `Browse ${label} from verified vendors with escrow-protected payment and tracked delivery.`,
  };
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-semibold transition",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/50"
      )}
    >
      {children}
    </Link>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const raw = await searchParams;
  const filters = parseSearchParams(raw);
  const { results, total, categoryCounts, vendors, splits } = await searchCatalog({ ...filters, limit: 40 });
  const filterCount = activeFilterCount(filters);
  const liveSplits = splits.slice(0, 3);
  const vendorById = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const resultVendors = [...new Set(results.map((entry) => entry.product.vendorId))]
    .map((id) => vendorById.get(id))
    .filter((vendor): vendor is NonNullable<typeof vendor> => Boolean(vendor));

  return (
    <div className="container py-6">
      <SearchTracker filters={filters} resultCount={total} />

      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[13px] text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Home
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-foreground">
          {hasAnyFilter(filters) ? describeSearch(filters) : "All listings"}
        </span>
      </nav>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {hasAnyFilter(filters) ? `Results for ${describeSearch(filters)}` : "Shop verified okirika"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} listing{total === 1 ? "" : "s"} · verified vendors · escrow protected
          </p>
        </div>
        {filterCount > 0 && (
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
            <Link href="/search">
              <X /> Clear {filterCount} filter{filterCount === 1 ? "" : "s"}
            </Link>
          </Button>
        )}
      </div>

      {/* ---------- Filter bar (GET form: works without JS, shareable URLs) ---------- */}
      <form action="/search" method="get" className="mt-4 rounded-2xl border bg-card p-4">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              type="search"
              defaultValue={filters.query ?? ""}
              placeholder="Search bales, sneakers, denim jackets…"
              aria-label="Search listings"
              className="bg-muted pl-10"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-[13px] font-semibold">
              <span className="mb-1 block text-muted-foreground">Category</span>
              <select
                name="category"
                defaultValue={filters.category ?? ""}
                className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">All categories</option>
                {CATEGORIES.filter((category) => category !== "All").map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[13px] font-semibold">
              <span className="mb-1 block text-muted-foreground">City</span>
              <select
                name="city"
                defaultValue={filters.city ?? ""}
                className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">All cities</option>
                {CITIES.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[13px] font-semibold">
              <span className="mb-1 block text-muted-foreground">Grade</span>
              <select
                name="grade"
                defaultValue={filters.grade ?? ""}
                className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">Any grade</option>
                {GRADES.map((grade) => (
                  <option key={grade} value={grade}>
                    Grade {grade}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[13px] font-semibold">
              <span className="mb-1 block text-muted-foreground">Sort</span>
              <select
                name="sort"
                defaultValue={filters.sort ?? "newest"}
                className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                {SORT_ORDER.map((sort) => (
                  <option key={sort} value={sort}>
                    {SORT_LABELS[sort]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[13px] font-semibold">
              <span className="mb-1 block text-muted-foreground">Min ₦</span>
              <Input
                name="min"
                inputMode="numeric"
                defaultValue={filters.minNaira ?? ""}
                placeholder="0"
                className="w-28"
              />
            </label>
            <label className="text-[13px] font-semibold">
              <span className="mb-1 block text-muted-foreground">Max ₦</span>
              <Input
                name="max"
                inputMode="numeric"
                defaultValue={filters.maxNaira ?? ""}
                placeholder="500,000"
                className="w-32"
              />
            </label>
            <label className="flex items-center gap-2 pb-3 text-[13px] font-semibold">
              <input type="checkbox" name="kind" value="bale" defaultChecked={filters.kind === "bale"} className="h-4 w-4" />
              Bale splits only
            </label>
            <Button type="submit" className="ml-auto">
              <SlidersHorizontal /> Apply filters
            </Button>
          </div>
        </div>
      </form>

      {/* ---------- Chip shortcuts ---------- */}
      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" role="list" aria-label="Quick filters">
        <FilterChip href={buildSearchHref(filters, { kind: filters.kind === "bale" ? null : "bale" })} active={filters.kind === "bale"}>
          <Filter className="h-3.5 w-3.5" /> Bale splits
        </FilterChip>
        {CATEGORIES.filter((category) => category !== "All").map((category) => (
          <FilterChip
            key={category}
            href={buildSearchHref(filters, { category: filters.category === category ? null : category })}
            active={filters.category === category}
          >
            {category}
            {categoryCounts[category] ? <span className="text-muted-foreground">({categoryCounts[category]})</span> : null}
          </FilterChip>
        ))}
        <FilterChip href={buildSearchHref(filters, { grade: filters.grade === "A" ? null : "A" })} active={filters.grade === "A"}>
          Grade A only
        </FilterChip>
        {CITIES.map((city) => (
          <FilterChip
            key={city}
            href={buildSearchHref(filters, { city: filters.city === city ? null : city })}
            active={filters.city === city}
          >
            {city}
          </FilterChip>
        ))}
      </div>

      {/* ---------- Results ---------- */}
      {results.length === 0 ? (
        <Card className="mt-6 p-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <SearchIcon className="h-7 w-7" />
          </span>
          <h2 className="mt-3 text-lg font-extrabold">No listings match {describeSearch(filters)}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Try removing a filter, searching a broader term (for example <b>shoes</b> or <b>bale</b>), or browse
            everything below.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {["bale", "sneakers", "denim", "gowns", "bags"].map((term) => (
              <Button key={term} variant="outline" size="sm" asChild>
                <Link href={`/search?q=${encodeURIComponent(term)}`}>{term}</Link>
              </Button>
            ))}
            <Button size="sm" asChild>
              <Link href="/search">Show everything</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            {results.map((entry) => (
              <ProductCard key={entry.product.id} product={entry.product} vendor={entry.vendor} />
            ))}
          </div>

          {liveSplits.length > 0 && filterCount === 0 && (
            <section className="mt-10">
              <SectionHeader
                title="Live splits you can join now"
                sub="Claim a slot before the countdown ends — auto-refund if a split doesn't fill."
                href="/search?kind=bale"
                linkLabel="See all splits"
              />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {liveSplits.map((entry) => (
                  <BaleSplitCard key={entry.bale.id} bale={entry.bale} product={entry.product} vendor={entry.vendor} />
                ))}
              </div>
            </section>
          )}

          {resultVendors.length > 0 && (
            <section className="mt-10">
              <SectionHeader title="Vendors in these results" sub="ID-verified shops; the inspected badge means we visited." />
              <div className="grid gap-4 md:grid-cols-2">
                {resultVendors.slice(0, 4).map((vendor) => (
                  <VendorCard key={vendor.id} vendor={vendor} productId={results.find((entry) => entry.product.vendorId === vendor.id)?.product.id} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <RecentlyViewedRail />
    </div>
  );
}

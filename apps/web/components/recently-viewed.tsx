"use client";

import Link from "next/link";
import { History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductArtFallback } from "@/components/product-art-fallback";
import { useRecentlyViewed } from "@/lib/store/hooks";
import { naira } from "@/lib/format";

/**
 * Recently viewed rail — pure client state, so it renders instantly with no
 * request. Research calls this out as the cheapest way to recover a returning
 * browser who never finished deciding.
 */
export function RecentlyViewedRail({ excludeId, limit = 6 }: { excludeId?: string; limit?: number }) {
  const { items, clear, hydrated } = useRecentlyViewed();
  const visible = items.filter((item) => item.productId !== excludeId).slice(0, limit);
  if (!hydrated || visible.length === 0) return null;

  return (
    <section className="mt-8" aria-labelledby="recently-viewed-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="recently-viewed-heading" className="flex items-center gap-2 text-lg font-extrabold">
          <History className="h-5 w-5 text-primary" aria-hidden="true" /> Recently viewed
        </h2>
        <Button variant="ghost" size="sm" onClick={clear} className="text-muted-foreground">
          <X /> Clear
        </Button>
      </div>
      <ul className="no-scrollbar -mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-1">
        {visible.map((item) => (
          <li key={item.productId} className="w-36 shrink-0 sm:w-40">
            <Link
              href={`/listing/${item.productId}`}
              className="flex flex-col overflow-hidden rounded-2xl border bg-card transition hover:-translate-y-0.5 hover:shadow-card"
            >
              <ProductArtFallback hue={item.hue} category={item.category} />
              <span className="flex flex-1 flex-col gap-1 p-2.5">
                <span className="line-clamp-2 text-[13px] font-semibold leading-snug">{item.title}</span>
                <span className="mt-auto text-sm font-extrabold tabular-nums">{naira(item.price)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

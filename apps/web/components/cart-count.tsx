"use client";

import { useCartCount } from "@/lib/store";

/**
 * Cart badge. Reads the persisted cart store, so adding an item anywhere in the
 * app updates the header immediately — and `useCartCount()` returns 0 for the
 * server render + first client render (no hydration mismatch, no flash of a
 * stale "2" like the old demo-mode placeholder).
 */
export function CartCount() {
  const count = useCartCount();
  if (count === 0) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
      {count > 99 ? "99+" : count}
    </span>
  );
}

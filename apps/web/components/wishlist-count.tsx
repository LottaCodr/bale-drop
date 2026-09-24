"use client";

import { useWishlistCount } from "@/lib/store/hooks";

/** Wishlist badge — same hydration-safe pattern as the cart badge. */
export function WishlistCount() {
  const count = useWishlistCount();
  if (count === 0) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

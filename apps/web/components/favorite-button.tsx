"use client";

import { Heart } from "lucide-react";
import type { Product, Vendor } from "@bale-drop/database";
import { useWishlistStore } from "@/lib/store/wishlist-store";
import { useIsWished } from "@/lib/store/hooks";
import { toWishInput } from "@/lib/store/snapshot";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * Wishlist heart — persisted in the wishlist store, mirrored to
 * `public.wishlists` when a session exists (see lib/wishlist-sync.ts).
 * Cards, listing pages and search results all share one state.
 */
export function FavoriteButton({
  product,
  vendor,
  className,
  withLabel = false,
}: {
  product: Product;
  vendor?: Pick<Vendor, "id" | "shopName"> | null;
  className?: string;
  withLabel?: boolean;
}) {
  const toggle = useWishlistStore((state) => state.toggle);
  const saved = useIsWished(product.id);

  function handleClick(event: React.MouseEvent) {
    // Cards wrap this button in a <Link>: never navigate on a heart tap.
    event.preventDefault();
    event.stopPropagation();
    const next = toggle(toWishInput(product, vendor));
    track(next ? "add_to_wishlist" : "remove_from_wishlist", {
      item_id: product.id,
      item_name: product.title,
      value: product.price,
    });
    void import("@/lib/wishlist-sync").then(({ pushWishlistToggle }) => pushWishlistToggle(product.id, next));
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${product.title} from wishlist` : `Save ${product.title} to wishlist`}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-full bg-background/90 shadow-sm backdrop-blur transition hover:scale-105 active:scale-95",
        withLabel ? "px-3 py-2 text-[13px] font-semibold" : "h-9 w-9",
        className
      )}
    >
      <Heart className={cn("h-4 w-4", saved ? "fill-red-500 text-red-500" : "text-foreground")} />
      {withLabel && <span>{saved ? "Saved" : "Save"}</span>}
    </button>
  );
}

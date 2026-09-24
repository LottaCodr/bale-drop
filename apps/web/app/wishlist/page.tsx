"use client";

import Link from "next/link";
import { ArrowRight, Heart, Loader2, ShoppingBag, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProductArtFallback } from "@/components/product-art-fallback";
import { GradeBadge } from "@/components/commerce";
import { useWishlistStore } from "@/lib/store/wishlist-store";
import { useHasMounted } from "@/lib/store/hooks";
import { useCartStore } from "@/lib/store/cart-store";
import { track } from "@/lib/analytics";
import { naira } from "@/lib/format";

/**
 * Saved items. Each row can move straight into the cart — the shortest path
 * from "I liked this" back to a checkout, and the reason the heart had to become
 * real state instead of a local `useState`.
 */
export default function WishlistPage() {
  const mounted = useHasMounted();
  const items = useWishlistStore((state) => state.items);
  const remove = useWishlistStore((state) => state.remove);
  const addToCart = useCartStore((state) => state.add);

  if (!mounted) {
    return (
      <div className="container max-w-4xl py-12">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading saved items…
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="container max-w-2xl py-12 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Heart className="h-8 w-8" />
        </span>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight">Nothing saved yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tap the heart on any listing to keep it here. Saved items sync to your account when you sign in.
        </p>
        <Button className="mt-5" asChild>
          <Link href="/search">
            Find something to save <ArrowRight />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Saved items</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {items.length} item{items.length === 1 ? "" : "s"} · we&apos;ll tell you if a price drops
          </p>
        </div>
        <Badge variant="outline">
          <Heart /> Synced to your account
        </Badge>
      </div>

      <Card className="mt-5 divide-y p-0">
        {items.map((item) => (
          <div key={item.productId} className="flex items-center gap-3 p-4">
            <Link href={`/listing/${item.productId}`} className="w-16 shrink-0 overflow-hidden rounded-xl border">
              <ProductArtFallback hue={item.hue} category={item.category} className="aspect-square w-full" />
            </Link>
            <div className="min-w-0 flex-1">
              <Link href={`/listing/${item.productId}`} className="line-clamp-2 text-sm font-semibold hover:text-primary">
                {item.title}
              </Link>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <GradeBadge grade={item.grade} />
                {item.vendorName} • {item.city}
              </p>
              <p className="mt-1 text-sm font-extrabold tabular-nums">{naira(item.price)}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <Button
                size="sm"
                onClick={() => {
                  addToCart(item);
                  track("add_to_cart", { item_id: item.productId, item_name: item.title, value: item.price, source: "wishlist" });
                }}
              >
                <ShoppingBag /> Add to cart
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  remove(item.productId);
                  track("remove_from_wishlist", { item_id: item.productId });
                }}
              >
                <Trash2 /> Remove
              </Button>
            </div>
          </div>
        ))}
      </Card>

      <div className="mt-4 flex justify-center">
        <Button variant="outline" asChild>
          <Link href="/search">Keep browsing</Link>
        </Button>
      </div>
    </div>
  );
}

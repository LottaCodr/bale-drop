"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Product, Vendor } from "@bale-drop/database";
import { useCartStore } from "@/lib/store/cart-store";
import { toCartLine } from "@/lib/store/snapshot";
import { useInCart } from "@/lib/store/hooks";
import { track } from "@/lib/analytics";
import { naira } from "@/lib/format";

/**
 * Add to cart — optimistic (the store updates synchronously), never redirects
 * (research: redirecting after add-to-cart costs additional items), and offers
 * the "View cart" next step in place.
 */
export function AddToCartButton({
  product,
  vendor,
  qty = 1,
  size = "lg",
  variant = "outline",
  className,
}: {
  product: Product;
  vendor?: Pick<Vendor, "id" | "shopName"> | null;
  qty?: number;
  size?: "sm" | "default" | "lg";
  variant?: "outline" | "default" | "accent" | "secondary";
  className?: string;
}) {
  const add = useCartStore((state) => state.add);
  const inCart = useInCart(product.id);
  const [justAdded, setJustAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function handleAdd() {
    add(toCartLine(product, vendor), qty);
    track("add_to_cart", {
      item_id: product.id,
      item_name: product.title,
      value: product.price * qty,
      quantity: qty,
      vendor_id: product.vendorId,
      currency: "NGN",
    });
    setJustAdded(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setJustAdded(false), 2600);
  }

  return (
    <Button variant={justAdded ? "default" : variant} size={size} onClick={handleAdd} className={className}>
      {justAdded ? <Check /> : <ShoppingBag />}
      {justAdded ? "Added" : inCart ? "Add another" : "Add to cart"}
      {!justAdded && inCart && <span className="sr-only"> — item is already in your cart</span>}
    </Button>
  );
}

/** Post-add confirmation row with the running total and a cart shortcut. */
export function AddedToCartNote({ product, qty = 1 }: { product: Product; qty?: number }) {
  const inCart = useInCart(product.id);
  if (!inCart) return null;
  return (
    <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
      <Check className="h-3.5 w-3.5 text-primary" />
      In your cart • {naira(product.price * qty)} •{" "}
      <Link href="/cart" className="font-semibold text-primary hover:underline">
        View cart
      </Link>
    </p>
  );
}

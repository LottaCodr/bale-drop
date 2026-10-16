"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, ShoppingBag, Trash2, X } from "lucide-react";
import { useCartStore, selectLines, selectSaved, selectSubtotal, selectItemCount, selectPromoCode } from "@/lib/store/cart-store";
import { QtyStepper } from "@/components/qty-stepper";
import { ProductArtFallback } from "@/components/product-art-fallback";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { naira } from "@/lib/format";
import { DELIVERY_SUBSIDY_NAIRA, DELIVERY_METHODS } from "@/lib/taxonomy";
import { cn } from "@/lib/utils";

export function CartDrawer() {
  const drawerOpen = useCartStore((state) => state.drawerOpen);
  const closeDrawer = useCartStore((state) => state.closeDrawer);
  const lines = useCartStore(selectLines);
  const saved = useCartStore(selectSaved);
  const subtotal = useCartStore(selectSubtotal);
  const count = useCartStore(selectItemCount);
  const promoCode = useCartStore(selectPromoCode);
  const remove = useCartStore((state) => state.remove);
  const setQty = useCartStore((state) => state.setQty);
  const saveForLater = useCartStore((state) => state.saveForLater);
  const moveToCart = useCartStore((state) => state.moveToCart);
  const removeSaved = useCartStore((state) => state.removeSaved);

  const delivery = DELIVERY_METHODS[0];
  const vendorCount = Math.max(1, new Set(lines.map((line) => line.vendorId)).size);
  const estimatedDelivery = delivery.fee * vendorCount;
  const subsidy = Math.min(DELIVERY_SUBSIDY_NAIRA, estimatedDelivery);
  const estimatedTotal = subtotal + estimatedDelivery - subsidy;

  // Close on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && drawerOpen) closeDrawer();
    }
    if (drawerOpen) {
      document.addEventListener("keydown", onKey);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawerOpen, closeDrawer]);

  if (!drawerOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
        onClick={closeDrawer}
        aria-hidden="true"
      />
      {/* Drawer */}
      <aside
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-background shadow-2xl ring-1 ring-border/40 animate-in slide-in-from-right duration-300"
        role="dialog"
        aria-modal="true"
        aria-label="Cart drawer"
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <ShoppingBag className="h-4.5 w-4.5" />
              </span>
              <div>
                <h2 className="text-base font-extrabold leading-tight">Your cart</h2>
                <p className="text-[11px] text-muted-foreground">
                  {count} item{count === 1 ? "" : "s"} • Escrow protected
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={closeDrawer} aria-label="Close cart drawer">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {lines.length === 0 && saved.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <ShoppingBag className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm font-semibold">Your cart is empty</p>
                <p className="text-xs text-muted-foreground">Items you add will appear here.</p>
                <Button size="sm" variant="outline" onClick={closeDrawer} asChild>
                  <Link href="/search">Browse listings</Link>
                </Button>
              </div>
            ) : (
              <>
                {/* Active lines */}
                {lines.length > 0 && (
                  <div className="flex flex-col gap-4">
                    {lines.map((line) => (
                      <div key={line.productId} className="flex gap-3">
                        <Link href={`/listing/${line.productId}`} className="w-16 shrink-0 overflow-hidden rounded-xl border" onClick={closeDrawer}>
                          <ProductArtFallback hue={line.hue} category={line.category} src={line.imageUrl} alt={line.title} className="aspect-square w-full" />
                        </Link>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <Link href={`/listing/${line.productId}`} className="line-clamp-2 text-sm font-semibold hover:text-primary" onClick={closeDrawer}>
                                {line.title}
                              </Link>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {line.vendorName} • Grade {line.grade}
                              </p>
                            </div>
                            <p className="shrink-0 text-sm font-extrabold tabular-nums">{naira(line.price * line.qty)}</p>
                          </div>
                          <div className="mt-2.5 flex items-center gap-2">
                            <QtyStepper
                              value={line.qty}
                              onChange={(next) => setQty(line.productId, next)}
                            />
                            <span className="text-[11px] text-muted-foreground tabular-nums">{naira(line.price)} each</span>
                          </div>
                          <div className="mt-2 flex gap-2">
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => saveForLater(line.productId)}>
                              Save for later
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-destructive hover:text-destructive" onClick={() => remove(line.productId)}>
                              <Trash2 className="h-3 w-3" /> Remove
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Saved for later */}
                {saved.length > 0 && (
                  <div className={cn("border-t pt-4", lines.length > 0 ? "mt-4" : "")}>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Saved for later</h3>
                    <div className="mt-3 flex flex-col gap-3">
                      {saved.map((line) => (
                        <div key={line.productId} className="flex items-center gap-3">
                          <div className="w-12 shrink-0 overflow-hidden rounded-lg border">
                            <ProductArtFallback hue={line.hue} category={line.category} src={line.imageUrl} alt={line.title} className="aspect-square w-full" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <Link href={`/listing/${line.productId}`} className="truncate text-sm font-semibold hover:text-primary" onClick={closeDrawer}>
                              {line.title}
                            </Link>
                            <p className="text-[11px] text-muted-foreground tabular-nums">{naira(line.price)}</p>
                          </div>
                          <Button variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" onClick={() => moveToCart(line.productId)}>
                            Move to cart
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => removeSaved(line.productId)} aria-label={`Remove ${line.title}`}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Promo */}
                {promoCode && (
                  <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[11px] text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                    Promo code <b>{promoCode}</b> will be verified at checkout.
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="border-t px-5 py-4">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="font-semibold tabular-nums">{naira(subtotal)}</dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>
                  Delivery <span className="text-[11px]">(est.)</span>
                </dt>
                <dd className="font-medium tabular-nums">{naira(estimatedDelivery)}</dd>
              </div>
              <div className="flex justify-between text-emerald-700 dark:text-emerald-300">
                <dt>Launch subsidy</dt>
                <dd className="font-semibold tabular-nums">−{naira(subsidy)}</dd>
              </div>
              <Separator className="my-1" />
              <div className="flex justify-between text-base">
                <dt className="font-bold">Estimated total</dt>
                <dd className="font-extrabold tabular-nums">{naira(estimatedTotal)}</dd>
              </div>
            </dl>
            <Button size="lg" className="mt-4 w-full" asChild>
              <Link href="/checkout" onClick={closeDrawer}>
                Checkout <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <div className="mt-2 flex gap-2">
              <Button variant="outline" className="flex-1" size="sm" onClick={closeDrawer} asChild>
                <Link href="/search">Continue shopping</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/cart">View full cart</Link>
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

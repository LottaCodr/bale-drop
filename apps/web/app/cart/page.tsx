"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Info,
  Loader2,
  Lock,
  ShieldCheck,
  ShoppingBag,
  Tag,
  Trash2,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { QtyStepper } from "@/components/qty-stepper";
import { RecentlyViewedRail } from "@/components/recently-viewed";
import { ProductArtFallback } from "@/components/product-art-fallback";
import { useCartStore, selectItemCount, selectSaved, selectSubtotal } from "@/lib/store/cart-store";
import { useHasMounted } from "@/lib/store/hooks";
import { useDeliveryCity } from "@/lib/store/hooks";
import { reconcileCart, type CartReconcileResult } from "@/lib/cart-sync";
import { DELIVERY_METHODS, DELIVERY_SUBSIDY_NAIRA } from "@/lib/taxonomy";
import { naira } from "@/lib/format";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * Cart — the screen that was missing from the storefront.
 *
 * The old flow sent the bag icon straight to /checkout, so quantities could not
 * be edited, items could not be removed, prices could not be re-checked and an
 * abandoned cart could not be resumed. Research is unambiguous that inline
 * editing + a visible total + a sticky mobile CTA is what keeps carts alive.
 */
export default function CartPage() {
  const mounted = useHasMounted();
  const lines = useCartStore((state) => state.lines);
  const saved = useCartStore(selectSaved);
  const count = useCartStore(selectItemCount);
  const subtotal = useCartStore(selectSubtotal);
  const promoCode = useCartStore((state) => state.promoCode);
  const applyPromo = useCartStore((state) => state.applyPromo);
  const setQty = useCartStore((state) => state.setQty);
  const remove = useCartStore((state) => state.remove);
  const saveForLater = useCartStore((state) => state.saveForLater);
  const moveToCart = useCartStore((state) => state.moveToCart);
  const removeSaved = useCartStore((state) => state.removeSaved);
  const city = useDeliveryCity();

  const [promoDraft, setPromoDraft] = useState("");
  const [promoNote, setPromoNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [changes, setChanges] = useState<CartReconcileResult | null>(null);

  const delivery = DELIVERY_METHODS[0];
  const subsidy = Math.min(DELIVERY_SUBSIDY_NAIRA, delivery.fee);
  const estimatedTotal = subtotal + delivery.fee - subsidy;

  /** Stable key: reconcile when the *set* of products changes, not on qty tweaks. */
  const lineSignature = lines.map((line) => `${line.productId}:${line.qty}`).join(",");

  // Funnel: cart viewed, then line-level events on each mutation.
  useEffect(() => {
    if (!mounted) return;
    track("view_cart", { items: count, value: subtotal, currency: "NGN" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report once per mount
  }, [mounted]);

  // Re-price against the catalog whenever the line-up changes.
  useEffect(() => {
    if (!mounted) return;
    const current = useCartStore.getState().lines;
    if (current.length === 0) return;
    let active = true;
    setChecking(true);
    reconcileCart(current)
      .then((result) => {
        if (active) setChanges(result);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [mounted, lineSignature]);

  const unavailable = useMemo(() => changes?.unavailable ?? [], [changes]);
  const repriced = useMemo(() => changes?.repriced ?? [], [changes]);
  const notice = unavailable.length > 0 || repriced.length > 0 ? { unavailable, repriced } : null;

  function handlePromo() {
    const code = promoDraft.trim().toUpperCase();
    if (!code) {
      applyPromo(null);
      setPromoNote(null);
      return;
    }
    applyPromo(code);
    // Codes are validated (and the discount applied) by paystack-initialize;
    // the cart only records the intent so checkout can send it.
    setPromoNote(`We'll verify “${code}” when you pay. Valid codes apply to your total.`);
    track("add_payment_info", { promo_code: code });
  }

  if (!mounted) {
    return (
      <div className="container max-w-4xl py-12">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your cart…
        </div>
      </div>
    );
  }

  if (lines.length === 0 && saved.length === 0) {
    return (
      <div className="container max-w-3xl py-10">
        <div className="text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <ShoppingBag className="h-8 w-8" />
          </span>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight">Your cart is empty</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Browse live bale splits or single pieces — everything is escrow protected.
          </p>
          <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild>
              <Link href="/search?kind=bale">
                Browse bale splits <ArrowRight />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/search">Shop all listings</Link>
            </Button>
          </div>
        </div>
        <RecentlyViewedRail limit={8} />
      </div>
    );
  }

  return (
    <div className="container max-w-5xl py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Your cart</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {count} item{count === 1 ? "" : "s"} •{" "}
            {checking ? "checking prices…" : "prices re-checked just now"}
          </p>
        </div>
        <Badge variant="verified">
          <ShieldCheck /> Escrow protected
        </Badge>
      </div>

      {notice && (
        <div role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/20">
          {unavailable.length > 0 && (
            <p className="font-semibold text-amber-900 dark:text-amber-100">
              {unavailable.length} item{unavailable.length === 1 ? "" : "s"} sold out or paused and{" "}
              {unavailable.length === 1 ? "was" : "were"} removed: {unavailable.map((line) => line.title).join(", ")}
            </p>
          )}
          {repriced.map((change) => (
            <p key={change.productId} className="mt-1 text-amber-900 dark:text-amber-100">
              <b>{change.title}</b> price changed from {naira(change.from)} to {naira(change.to)} — your cart was
              updated.
            </p>
          ))}
        </div>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <Card className="divide-y p-0">
            {lines.map((line) => (
              <div key={line.productId} className="flex gap-3 p-4">
                <Link href={`/listing/${line.productId}`} className="w-20 shrink-0 overflow-hidden rounded-xl border">
                  <ProductArtFallback hue={line.hue} category={line.category} className="aspect-square w-full" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/listing/${line.productId}`} className="line-clamp-2 text-sm font-semibold hover:text-primary">
                        {line.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {line.vendorName} • {line.city} • Grade {line.grade}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-extrabold tabular-nums">{naira(line.price * line.qty)}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <QtyStepper
                      value={line.qty}
                      onChange={(next) => {
                        setQty(line.productId, next);
                        track("add_to_cart", { item_id: line.productId, quantity: next, value: line.price * next });
                      }}
                    />
                    <span className="text-xs text-muted-foreground tabular-nums">{naira(line.price)} each</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-muted-foreground"
                      onClick={() => {
                        saveForLater(line.productId);
                        track("save_for_later", { item_id: line.productId, value: line.price * line.qty });
                      }}
                    >
                      Save for later
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={() => {
                        remove(line.productId);
                        track("remove_from_cart", { item_id: line.productId, value: line.price * line.qty });
                      }}
                    >
                      <Trash2 /> Remove
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </Card>

          {saved.length > 0 && (
            <Card className="p-4">
              <h2 className="flex items-center gap-2 font-bold">
                <Tag className="h-4 w-4 text-primary" /> Saved for later ({saved.length})
              </h2>
              <div className="mt-3 flex flex-col divide-y">
                {saved.map((line) => (
                  <div key={line.productId} className="flex items-center gap-3 py-3">
                    <div className="w-12 shrink-0 overflow-hidden rounded-lg border">
                      <ProductArtFallback hue={line.hue} category={line.category} className="aspect-square w-full" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{line.title}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">{naira(line.price)}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => moveToCart(line.productId)}>
                      Move to cart
                    </Button>
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => removeSaved(line.productId)}>
                      <Trash2 />
                      <span className="sr-only">Remove {line.title}</span>
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-4">
            <h2 className="flex items-center gap-2 font-bold">
              <Tag className="h-4 w-4 text-primary" /> Promo code
            </h2>
            <div className="mt-3 flex gap-2">
              <Input
                value={promoDraft}
                onChange={(event) => setPromoDraft(event.target.value.toUpperCase())}
                placeholder="e.g. LAUNCH1500"
                aria-label="Promo code"
                className="uppercase"
              />
              <Button variant="outline" onClick={handlePromo}>
                Apply
              </Button>
            </div>
            {promoCode && (
              <p className="mt-2 flex items-center gap-1.5 text-[13px] text-emerald-700 dark:text-emerald-300">
                <BadgeCheck className="h-3.5 w-3.5" /> Code <b>{promoCode}</b> will be verified at payment.
              </p>
            )}
            {promoNote && <p className="mt-2 text-xs text-muted-foreground">{promoNote}</p>}
          </Card>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Prices are confirmed by our server when you pay. If anything changed, we tell you before the charge —
            never after.
          </p>
        </div>

        <div className="lg:sticky lg:top-32 lg:self-start">
          <Card className="p-5">
            <h2 className="font-bold">Order summary</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="font-semibold tabular-nums">{naira(subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  Delivery to {city} <span className="block text-xs">from {naira(delivery.fee)}</span>
                </dt>
                <dd className="font-semibold tabular-nums">{naira(delivery.fee)}</dd>
              </div>
              <div className="flex justify-between text-emerald-700 dark:text-emerald-300">
                <dt>Launch subsidy</dt>
                <dd className="font-semibold tabular-nums">−{naira(subsidy)}</dd>
              </div>
              <Separator />
              <div className="flex justify-between text-base">
                <dt className="font-bold">Estimated total</dt>
                <dd className="font-extrabold tabular-nums">{naira(estimatedTotal)}</dd>
              </div>
            </dl>
            <Button size="lg" className="mt-4 w-full" asChild>
              <Link href="/checkout" onClick={() => track("begin_checkout", { items: count, value: estimatedTotal, currency: "NGN" })}>
                Checkout <ArrowRight />
              </Link>
            </Button>
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" /> Delivery fee and promo are finalised on the next step
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Truck className="h-3.5 w-3.5 text-primary" /> Tracked door-to-door in Lagos, Abuja, PH &amp; Kano
            </p>
          </Card>
          <Button variant="ghost" className="mt-2 w-full text-muted-foreground" asChild>
            <Link href="/search">Continue shopping</Link>
          </Button>
        </div>
      </div>

      {/* Mobile sticky checkout bar (thumb zone, always visible) */}
      {lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-background/95 backdrop-blur md:hidden">
          <div className={cn("container flex items-center gap-3 py-2.5")}>
            <div>
              <div className="text-base font-extrabold tabular-nums">{naira(estimatedTotal)}</div>
              <div className="text-[11px] text-muted-foreground">{count} item{count === 1 ? "" : "s"} • incl. delivery</div>
            </div>
            <Button className="ml-auto shrink-0" asChild>
              <Link href="/checkout" onClick={() => track("begin_checkout", { items: count, value: estimatedTotal, currency: "NGN" })}>
                Checkout <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      )}

      <RecentlyViewedRail limit={8} />
    </div>
  );
}

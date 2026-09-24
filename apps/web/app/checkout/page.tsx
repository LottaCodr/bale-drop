"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BadgeCheck,
  CreditCard,
  Info,
  Landmark,
  Loader2,
  Lock,
  MapPin,
  ShieldCheck,
  Smartphone,
  Truck,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ProductArtFallback } from "@/components/product-art-fallback";
import { EscrowNote } from "@/components/commerce";
import { isSupabaseLive } from "@/lib/config";
import { naira } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase";
import { initializePayment } from "@/lib/payments";
import { useCartStore, selectItemCount, selectSubtotal } from "@/lib/store/cart-store";
import { useCheckoutDraft, useHasMounted } from "@/lib/store/hooks";
import { usePrefsStore } from "@/lib/store/prefs-store";
import { reconcileCart, type CartReconcileResult } from "@/lib/cart-sync";
import { DELIVERY_METHODS, DELIVERY_SUBSIDY_NAIRA } from "@/lib/taxonomy";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * Checkout — one page: items → delivery → pay.
 *
 * State rules:
 * - Items come from the persisted cart store (survives the sign-in redirect, a
 *   refresh, or a closed tab) instead of being re-derived from the URL.
 * - The *draft* (delivery method, payment method, typed address, promo) is
 *   persisted too: losing a half-filled address is a top reason carts die.
 * - Prices are re-checked before payment and the server re-prices again inside
 *   `paystack-initialize`; the browser never decides what is charged.
 * - Success is decided by the signed webhook updating `payment_sessions`, never
 *   by the Paystack redirect.
 */

const PAY_METHODS = [
  { id: "card", name: "Card", sub: "Verve, Mastercard, Visa", icon: CreditCard },
  { id: "bank_transfer", name: "Bank transfer", sub: "Instant verification", icon: Landmark },
  { id: "ussd", name: "USSD", sub: "All Nigerian banks", icon: Smartphone },
] as const;

type ReturnState = "checking" | "pending" | "success" | "failed" | "missing";

function PaymentSuccess({
  amount,
  orderIds,
  isSlot,
}: {
  amount: number;
  orderIds: string[];
  isSlot: boolean;
}) {
  const label = isSlot ? "Slot payment confirmed!" : "Payment successful!";
  return (
    <div className="container max-w-lg py-12 text-center">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <BadgeCheck className="h-8 w-8" />
      </span>
      <h1 className="mt-4 text-2xl font-extrabold">{label}</h1>
      <p className="mt-2 text-muted-foreground">
        {isSlot ? (
          <>Your Bale Split slot is locked. {naira(amount)} is held in escrow until the split fills.</>
        ) : (
          <>
            Order{orderIds.length > 1 ? "s" : ""}{" "}
            <b className="text-foreground">{orderIds.map((id) => `BD-${id.slice(0, 6).toUpperCase()}`).join(", ")}</b> •{" "}
            {naira(amount)} held in escrow. The vendor has been notified.
          </>
        )}
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button asChild>
          <Link href="/orders">Track your order</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/search">Keep shopping</Link>
        </Button>
      </div>
    </div>
  );
}

function CheckoutExperience() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const live = isSupabaseLive();
  const mounted = useHasMounted();
  const reference = searchParams.get("reference") || searchParams.get("trxref");
  const demoPaid = !live && searchParams.get("demo_paid") === "1";

  const lines = useCartStore((state) => state.lines);
  const subtotal = useCartStore(selectSubtotal);
  const count = useCartStore(selectItemCount);
  const clearCart = useCartStore((state) => state.clear);
  const { checkout: draft, patchCheckout, patchShipping, resetCheckout } = useCheckoutDraft();
  const prefsCity = usePrefsStore((state) => state.city);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [priceChanges, setPriceChanges] = useState<CartReconcileResult | null>(null);
  const [paymentState, setPaymentState] = useState<"idle" | "processing">("idle");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const orderIdempotencyKey = useRef<string | null>(null);
  const [returnState, setReturnState] = useState<ReturnState | null>(reference ? "checking" : null);
  const [returnSession, setReturnSession] = useState<{ amount: number; orderIds: string[]; isSlot: boolean } | null>(null);

  const delivery = draft.delivery;
  const payMethod = draft.payment;
  const shipping = draft.shipping;

  // Default the draft address from the saved default address once.
  useEffect(() => {
    if (!live || reference || !mounted) return;
    if (shipping.fullAddress && shipping.phone) return;
    const sb = supabaseBrowser();
    sb.auth
      .getUser()
      .then(async ({ data: { user } }) => {
        if (!user) return;
        const { data } = await sb
          .from("addresses")
          .select("id, full_address, city, phone")
          .eq("profile_id", user.id)
          .eq("is_default", true)
          .maybeSingle();
        if (data) {
          patchShipping({ addressId: data.id, fullAddress: data.full_address, city: data.city, phone: data.phone });
        } else {
          patchShipping({ city: prefsCity });
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once after hydration
  }, [live, reference, mounted]);

  /** Stable key: re-price when the *set* of products changes, not on qty tweaks. */
  const lineSignature = lines.map((line) => `${line.productId}:${line.qty}`).join(",");

  // Re-price the cart before money moves; the buyer always sees the delta first.
  useEffect(() => {
    if (!mounted) return;
    const current = useCartStore.getState().lines;
    if (current.length === 0) return;
    let active = true;
    reconcileCart(current).then((result) => {
      if (!active) return;
      setPriceChanges(result);
      if (result.unavailable.length > 0) {
        setLoadError(
          `${result.unavailable.length} item${result.unavailable.length === 1 ? " is" : "s are"} no longer available and ${
            result.unavailable.length === 1 ? "was" : "were"
          } removed from your cart.`
        );
      }
    });
    track("begin_checkout", { items: current.reduce((sum, line) => sum + line.qty, 0), value: selectSubtotal(useCartStore.getState()), currency: "NGN" });
  }, [mounted, lineSignature]);

  // Wait for the signed webhook to confirm payment (Realtime on payment_sessions).
  useEffect(() => {
    if (!live || !reference) return;
    const paymentReference = reference;
    const sb = supabaseBrowser();
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    async function readStatus() {
      const { data, error } = await sb
        .from("payment_sessions")
        .select("status, amount_naira, order_ids, kind")
        .eq("reference", paymentReference)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setReturnState("missing");
        return;
      }
      if (!data) {
        setReturnState("checking");
        return;
      }
      setReturnSession({ amount: data.amount_naira, orderIds: data.order_ids ?? [], isSlot: data.kind === "slot" });
      if (data.status === "success") setReturnState("success");
      else if (data.status === "failed" || data.status === "abandoned") setReturnState("failed");
      else setReturnState("pending");
    }

    void readStatus();
    const channel = sb
      .channel(`payment-session-${paymentReference}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "payment_sessions", filter: `reference=eq.${paymentReference}` },
        (payload) => {
          const next = payload.new as { status?: string; amount_naira?: number; order_ids?: string[]; kind?: string };
          setReturnSession({
            amount: Number(next.amount_naira ?? 0),
            orderIds: next.order_ids ?? [],
            isSlot: next.kind === "slot",
          });
          if (next.status === "success") setReturnState("success");
          else if (next.status === "failed" || next.status === "abandoned") setReturnState("failed");
          else setReturnState("pending");
        }
      )
      .subscribe();
    timeout = setTimeout(() => {
      if (active) setReturnState((current) => (current === "checking" || current === "pending" ? "pending" : current));
    }, 45_000);

    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
      void sb.removeChannel(channel);
    };
  }, [live, reference]);

  // A confirmed payment empties the cart and the checkout draft.
  useEffect(() => {
    if (returnState !== "success" || !returnSession) return;
    clearCart();
    resetCheckout();
    track("purchase", { value: returnSession.amount, currency: "NGN", transaction_id: reference ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per confirmation
  }, [returnState, returnSession]);

  const fee = DELIVERY_METHODS.find((method) => method.id === delivery)?.fee ?? DELIVERY_METHODS[0].fee;
  const subsidy = Math.min(DELIVERY_SUBSIDY_NAIRA, fee);
  const total = subtotal + fee - subsidy;
  const repricedNotice = useMemo(() => priceChanges?.repriced ?? [], [priceChanges]);

  if (demoPaid) {
    return <PaymentSuccess amount={total} orderIds={["2103"]} isSlot={false} />;
  }

  async function pay() {
    setPaymentError(null);
    if (!live) {
      setPaymentState("processing");
      router.push(`/checkout?demo_paid=1`);
      return;
    }
    if (lines.length === 0) {
      setPaymentError("Add an available listing before paying.");
      return;
    }
    if (shipping.fullAddress.trim().length < 5 || shipping.phone.replace(/\D/g, "").length < 10) {
      setPaymentError("Add a complete delivery address and phone number.");
      return;
    }
    setPaymentState("processing");
    const sb = supabaseBrowser();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) {
      // The cart + draft live in storage, so this redirect is lossless — the
      // buyer lands back here with everything they typed still in place.
      router.push(`/login?next=${encodeURIComponent("/checkout")}`);
      return;
    }

    if (shipping.addressId) {
      await sb
        .from("addresses")
        .update({ full_address: shipping.fullAddress.trim(), city: shipping.city, phone: shipping.phone.trim(), is_default: true })
        .eq("id", shipping.addressId)
        .eq("profile_id", user.id);
    } else {
      const { data: saved } = await sb
        .from("addresses")
        .insert({
          profile_id: user.id,
          label: "Checkout",
          full_address: shipping.fullAddress.trim(),
          city: shipping.city,
          phone: shipping.phone.trim(),
          is_default: true,
        })
        .select("id")
        .maybeSingle();
      if (saved?.id) patchShipping({ addressId: saved.id });
    }

    track("add_payment_info", { payment_type: payMethod, value: total, currency: "NGN" });

    const idempotencyKey = orderIdempotencyKey.current ?? crypto.randomUUID();
    orderIdempotencyKey.current = idempotencyKey;

    const { data, error, retry_same_attempt: retrySameAttempt } = await initializePayment({
      kind: "order",
      idempotency_key: idempotencyKey,
      items: lines.map((line) => ({ product_id: line.productId, qty: line.qty })),
      shipping: {
        address_id: shipping.addressId || undefined,
        full_address: shipping.fullAddress.trim(),
        city: shipping.city,
        phone: shipping.phone.trim(),
      },
      delivery_method: delivery,
      payment_method: payMethod,
      promo_code: draft.promoCode || undefined,
      callback_url: `${window.location.origin}/checkout`,
    });

    if (error || !data) {
      if (!retrySameAttempt) orderIdempotencyKey.current = null;
      setPaymentState("idle");
      setPaymentError(error ?? "Could not start payment.");
      return;
    }
    if (data.already_processed) {
      setPaymentState("idle");
      clearCart();
      resetCheckout();
      router.push("/orders");
      return;
    }
    if (!data.authorization_url) {
      setPaymentState("idle");
      setPaymentError("Paystack did not return an authorization link.");
      return;
    }
    track("place_order", { value: data.amount_naira ?? total, currency: "NGN", transaction_id: data.reference });
    setPaymentState("processing");
    window.location.assign(data.authorization_url);
  }

  if (live && reference && returnState === "success" && returnSession) {
    return <PaymentSuccess amount={returnSession.amount} orderIds={returnSession.orderIds} isSlot={returnSession.isSlot} />;
  }

  if (live && reference) {
    return (
      <div className="container max-w-lg py-12 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          {returnState === "failed" ? <Info className="h-8 w-8" /> : <Loader2 className="h-8 w-8 animate-spin" />}
        </span>
        <h1 className="mt-4 text-2xl font-extrabold">
          {returnState === "failed" ? "Payment not completed" : "Confirming your payment…"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {returnState === "failed"
            ? "No order was marked paid. Your cart is still saved — you can retry with another Paystack method."
            : "Paystack sent you back safely. We are waiting for the signed webhook before we mark escrow as held — please don’t pay twice."}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link href="/orders">View orders</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/cart">Back to cart</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!mounted) {
    return (
      <div className="container max-w-5xl py-12">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading secure checkout…
        </div>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="container max-w-lg py-12 text-center">
        <h1 className="text-2xl font-extrabold">Your checkout is empty</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose an active listing first. Prices are rechecked securely when you pay.
        </p>
        {loadError && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{loadError}</p>
        )}
        <Button className="mt-5" asChild>
          <Link href="/search">Browse listings</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container max-w-5xl py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Checkout</h1>
          <p className="mt-1 text-sm text-muted-foreground">Cart → delivery → Pay. One page, no surprises.</p>
        </div>
        {live && <Badge variant="outline">Test-mode checkout</Badge>}
      </div>

      {paymentError && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {paymentError}
        </p>
      )}
      {loadError && (
        <p role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/20">
          {loadError}
        </p>
      )}
      {repricedNotice.map((change) => (
        <p key={change.productId} role="status" className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/20">
          <b>{change.title}</b> changed from {naira(change.from)} to {naira(change.to)} — your total below already
          reflects it.
        </p>
      ))}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-5">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">
                Your items ({count} item{count === 1 ? "" : "s"})
              </h2>
              <Button variant="link" size="sm" className="h-auto p-0" asChild>
                <Link href="/cart">Edit cart</Link>
              </Button>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {lines.map((line) => (
                <div key={line.productId} className="flex items-center gap-3">
                  <div className="w-16 shrink-0 overflow-hidden rounded-xl border">
                    <ProductArtFallback hue={line.hue} category={line.category} className="aspect-square w-full" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{line.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Qty {line.qty} • {line.vendorName} • {line.city}
                    </p>
                  </div>
                  <p className="text-sm font-extrabold tabular-nums">{naira(line.price * line.qty)}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MapPin className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-bold">Delivery address</h2>
                <p className="text-xs text-muted-foreground">Saved to your buyer profile and snapshotted on the order.</p>
              </div>
              <Button variant="link" size="sm" className="h-auto shrink-0 p-0" asChild>
                <Link href="/account/addresses">Manage saved</Link>
              </Button>
            </div>
            <div className="mt-3 grid gap-3">
              <Input
                aria-label="Street address"
                placeholder="Street address"
                autoComplete="street-address"
                value={shipping.fullAddress}
                onChange={(event) => patchShipping({ fullAddress: event.target.value })}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  aria-label="City"
                  placeholder="City"
                  autoComplete="address-level2"
                  value={shipping.city}
                  onChange={(event) => patchShipping({ city: event.target.value })}
                />
                <Input
                  aria-label="Delivery phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="Phone"
                  value={shipping.phone}
                  onChange={(event) => patchShipping({ phone: event.target.value })}
                />
              </div>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" /> Your address is saved on this device so you never re-type it.
            </p>
          </Card>

          <Card className="p-4">
            <h2 className="font-bold">Delivery method</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Delivery method">
              {DELIVERY_METHODS.map((method) => (
                <button
                  key={method.id}
                  type="button"
                  role="radio"
                  aria-checked={delivery === method.id}
                  onClick={() => patchCheckout({ delivery: method.id })}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border p-3 text-left transition",
                    delivery === method.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50"
                  )}
                >
                  {method.id === "express" ? <Zap className="h-5 w-5 shrink-0 text-primary" /> : <Truck className="h-5 w-5 shrink-0 text-primary" />}
                  <span className="flex-1">
                    <span className="block text-sm font-bold">{method.name}</span>
                    <span className="block text-xs text-muted-foreground">{method.eta}</span>
                  </span>
                  <span className="text-sm font-extrabold tabular-nums">{naira(method.fee)}</span>
                </button>
              ))}
            </div>
            <p className={cn("mt-2 text-[13px]", subsidy > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
              {subsidy > 0
                ? `Launch promo: ${naira(subsidy)} delivery subsidy applied at checkout.`
                : "No delivery promotion is active for this order."}
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Payment method</h2>
              <Badge variant="outline">Secured by Paystack</Badge>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Payment method">
              {PAY_METHODS.map((method) => (
                <button
                  key={method.id}
                  type="button"
                  role="radio"
                  aria-checked={payMethod === method.id}
                  onClick={() => {
                    patchCheckout({ payment: method.id });
                    track("add_payment_info", { payment_type: method.id });
                  }}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition",
                    payMethod === method.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50"
                  )}
                >
                  <method.icon className="h-5 w-5 text-primary" />
                  <span className="text-sm font-bold">{method.name}</span>
                  <span className="text-xs text-muted-foreground">{method.sub}</span>
                </button>
              ))}
            </div>
            <EscrowNote className="mt-3" />
          </Card>
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
                <dt className="text-muted-foreground">Delivery</dt>
                <dd className="font-semibold tabular-nums">{naira(fee)}</dd>
              </div>
              <div className="flex justify-between text-emerald-700 dark:text-emerald-300">
                <dt>Promo subsidy</dt>
                <dd className="font-semibold tabular-nums">−{naira(subsidy)}</dd>
              </div>
              {draft.promoCode && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Promo code</dt>
                  <dd className="font-semibold">{draft.promoCode}</dd>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-base">
                <dt className="font-bold">Total</dt>
                <dd className="font-extrabold tabular-nums">{naira(total)}</dd>
              </div>
            </dl>
            <Button size="lg" className="mt-4 w-full" onClick={pay} disabled={paymentState === "processing"}>
              {paymentState === "processing" ? (
                <>
                  <Loader2 className="animate-spin" /> {live ? "Opening Paystack…" : "Processing payment…"}
                </>
              ) : (
                <>Pay {naira(total)}</>
              )}
            </Button>
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" /> Held in escrow until you confirm delivery
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Truck className="h-3.5 w-3.5 text-primary" /> Delivery to {shipping.city || prefsCity} in {delivery === "express" ? "1 day" : "2–4 days"}
            </p>
          </Card>
          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{" "}
            {live
              ? "You’ll leave Bale Drop for Paystack’s secure test checkout. We only show success after the signed webhook confirms payment."
              : "Demo mode: no payment leaves this browser."}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="container py-12 text-center text-sm text-muted-foreground">Loading checkout…</div>}>
      <CheckoutExperience />
    </Suspense>
  );
}

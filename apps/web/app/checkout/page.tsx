"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, CreditCard, Info, Landmark, Loader2, MapPin, ShieldCheck, Smartphone, Truck, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { EscrowNote, ProductArt } from "@/components/commerce";
import { isSupabaseLive } from "@/lib/config";
import { naira } from "@/lib/format";
import { clearCart, readCart, type CartItem } from "@/lib/cart";
import { supabaseBrowser } from "@/lib/supabase";
import { initializePayment } from "@/lib/payments";
import { getProduct } from "@/lib/mock";
import { mapProductRow, type Product } from "@bale-drop/database";
import { cn } from "@/lib/utils";

/**
 * Checkout — one page, test-mode Paystack redirect + webhook confirmation.
 * Demo mode keeps the clickable prototype. Live mode accepts a product ID
 * from the listing URL, asks the Edge Function to price the order server-side,
 * and waits for payment_sessions Realtime confirmation after Paystack returns.
 */

const DEMO_CART = [
  { productId: "p4", qty: 1 },
  { productId: "p7", qty: 1 },
];

const DELIVERY = [
  { id: "standard", name: "Standard", eta: "2–4 days", fee: 2500, icon: Truck },
  { id: "express", name: "Express", eta: "Next day (Lagos)", fee: 4500, icon: Zap },
] as const;

const PAY_METHODS = [
  { id: "card", name: "Card", sub: "Verve, Mastercard, Visa", icon: CreditCard },
  { id: "bank_transfer", name: "Bank transfer", sub: "Instant verification", icon: Landmark },
  { id: "ussd", name: "USSD", sub: "All Nigerian banks", icon: Smartphone },
] as const;

type DeliveryId = (typeof DELIVERY)[number]["id"];
type PayMethodId = (typeof PAY_METHODS)[number]["id"];
type ReturnState = "checking" | "pending" | "success" | "failed" | "missing";

function PaymentSuccess({ amount, orderIds, isSlot }: { amount: number; orderIds: string[]; isSlot: boolean }) {
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
          <>Order{orderIds.length > 1 ? "s" : ""} <b className="text-foreground">{orderIds.map((id) => `BD-${id.slice(0, 6).toUpperCase()}`).join(", ")}</b> • {naira(amount)} held in escrow. The vendor has been notified.</>
        )}
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button asChild><Link href="/orders">Track your order</Link></Button>
        <Button variant="outline" asChild><Link href="/">Keep shopping</Link></Button>
      </div>
    </div>
  );
}

function CheckoutExperience() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const live = isSupabaseLive();
  const productId = searchParams.get("product");
  const reference = searchParams.get("reference") || searchParams.get("trxref");
  const demoPaid = !live && searchParams.get("demo_paid") === "1";

  const [liveProducts, setLiveProducts] = useState<Product[]>([]);
  const [liveCart, setLiveCart] = useState<CartItem[]>([]);
  const [liveSubsidy, setLiveSubsidy] = useState(0);
  const [loadingProducts, setLoadingProducts] = useState(live);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<DeliveryId>("standard");
  const [payMethod, setPayMethod] = useState<PayMethodId>("card");
  const [shipping, setShipping] = useState({ address_id: "", full_address: "14 Admiralty Way, Lekki Phase 1", city: "Lagos", phone: "0803 123 4567" });
  const [paymentState, setPaymentState] = useState<"idle" | "processing">("idle");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const orderIdempotencyKey = useRef<string | null>(null);
  const [returnState, setReturnState] = useState<ReturnState | null>(reference ? "checking" : null);
  const [returnSession, setReturnSession] = useState<{ amount: number; orderIds: string[]; isSlot: boolean } | null>(null);

  useEffect(() => {
    if (!live || reference) {
      setLoadingProducts(false);
      return;
    }

    let cancelled = false;
    const storedCart = readCart();
    const requestedCart = productId ? [{ productId, qty: 1 }] : storedCart;
    setLiveCart(requestedCart);
    setLoadingProducts(true);
    if (requestedCart.length === 0) {
      setLoadingProducts(false);
      return;
    }
    const sb = supabaseBrowser();
    const ids = [...new Set(requestedCart.map((item) => item.productId))];
    Promise.all([
      sb.from("products").select("*").in("id", ids).eq("status", "active"),
      sb.from("promo_codes").select("amount_naira, max_uses, used, expires_at").eq("code", "LAUNCH1500").eq("active", true).maybeSingle(),
    ]).then(([productResult, promoResult]) => {
      if (cancelled) return;
      const { data, error } = productResult;
      if (error || !data || data.length !== ids.length) setLoadError(error?.message ?? "One or more listings are no longer available.");
      else setLiveProducts(data.map(mapProductRow));
      const promo = promoResult.data;
      const promoAvailable = promo && (!promo.expires_at || new Date(promo.expires_at) > new Date()) && (promo.max_uses == null || promo.used < promo.max_uses);
      setLiveSubsidy(promoAvailable ? Number(promo.amount_naira) : 0);
      setLoadingProducts(false);
    });
    return () => { cancelled = true; };
  }, [live, productId, reference]);

  useEffect(() => {
    if (!live) return;
    const sb = supabaseBrowser();
    sb.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await sb.from("addresses").select("id, full_address, city, phone").eq("profile_id", user.id).eq("is_default", true).maybeSingle();
      if (data) setShipping({ address_id: data.id, full_address: data.full_address, city: data.city, phone: data.phone });
    });
  }, [live]);

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
      setReturnSession({
        amount: data.amount_naira,
        orderIds: data.order_ids ?? [],
        isSlot: data.kind === "slot",
      });
      if (data.status === "success") setReturnState("success");
      else if (data.status === "failed" || data.status === "abandoned") setReturnState("failed");
      else setReturnState("pending");
    }

    void readStatus();
    const channel = sb
      .channel(`payment-session-${reference}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "payment_sessions", filter: `reference=eq.${reference}` },
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
      if (active) setReturnState((current) => current === "checking" || current === "pending" ? "pending" : current);
    }, 45_000);

    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
      void sb.removeChannel(channel);
    };
  }, [live, reference]);

  useEffect(() => {
    if (returnState === "success") clearCart();
  }, [returnState]);

  const items = live
    ? liveProducts.map((product) => ({ product, qty: liveCart.find((item) => item.productId === product.id)?.qty ?? 1 }))
    : DEMO_CART.map((item) => ({ ...item, product: getProduct(item.productId) }));
  const subtotal = items.reduce((sum, item) => sum + item.product.price * item.qty, 0);
  const fee = DELIVERY.find((method) => method.id === delivery)!.fee;
  const subsidy = live ? Math.min(liveSubsidy, fee) : 1500;
  const total = subtotal + fee - subsidy;

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
    if (items.length === 0) {
      setPaymentError("Add an available listing before paying.");
      return;
    }
    setPaymentState("processing");
    const sb = supabaseBrowser();
    const { data: userData } = await sb.auth.getUser();
    if (!userData.user) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    if (shipping.full_address.trim().length < 5 || shipping.phone.replace(/\D/g, "").length < 10) {
      setPaymentState("idle");
      setPaymentError("Add a complete delivery address and phone number.");
      return;
    }
    let addressId = shipping.address_id || undefined;
    if (addressId) {
      const { error: addressError } = await sb.from("addresses").update({ full_address: shipping.full_address.trim(), city: shipping.city, phone: shipping.phone.trim(), is_default: true }).eq("id", addressId).eq("profile_id", userData.user.id);
      if (addressError) { setPaymentState("idle"); setPaymentError(addressError.message); return; }
    } else {
      await sb.from("addresses").update({ is_default: false }).eq("profile_id", userData.user.id);
      const { data: savedAddress, error: addressError } = await sb.from("addresses").insert({ profile_id: userData.user.id, label: "Home", full_address: shipping.full_address.trim(), city: shipping.city, phone: shipping.phone.trim(), is_default: true }).select("id").single();
      if (addressError || !savedAddress) { setPaymentState("idle"); setPaymentError(addressError?.message ?? "Could not save delivery address"); return; }
      addressId = savedAddress.id;
    }
    const idempotencyKey = orderIdempotencyKey.current ?? crypto.randomUUID();
    orderIdempotencyKey.current = idempotencyKey;
    const { data, error, retry_same_attempt: retrySameAttempt } = await initializePayment({
      kind: "order",
      idempotency_key: idempotencyKey,
      items: items.map((item) => ({ product_id: item.product.id, qty: item.qty })),
      shipping: { address_id: addressId, full_address: shipping.full_address.trim(), city: shipping.city, phone: shipping.phone.trim() },
      delivery_method: delivery,
      payment_method: payMethod,
      promo_code: "LAUNCH1500",
      callback_url: `${window.location.origin}/checkout`,
    });
    if (error || !data) {
      setPaymentState("idle");
      if (!retrySameAttempt) orderIdempotencyKey.current = null;
      setPaymentError(error ?? "Could not start payment.");
      return;
    }
    if (data.already_processed) {
      setPaymentState("idle");
      router.push("/orders");
      return;
    }
    if (!data.authorization_url) {
      setPaymentState("idle");
      setPaymentError("Paystack did not return an authorization link.");
      return;
    }
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
            ? "No order was marked paid. You can return to checkout and try another Paystack method."
            : "Paystack sent you back safely. We are waiting for the signed webhook before we mark escrow as held — please don’t pay twice."}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild><Link href="/orders">View orders</Link></Button>
          <Button variant="outline" asChild><Link href="/">Keep shopping</Link></Button>
        </div>
      </div>
    );
  }

  if (live && loadingProducts) {
    return (
      <div className="container max-w-5xl py-12">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading secure checkout…</div>
      </div>
    );
  }

  if (live && (loadError || items.length === 0)) {
    return (
      <div className="container max-w-lg py-12 text-center">
        <h1 className="text-2xl font-extrabold">Your checkout is empty</h1>
        <p className="mt-2 text-sm text-muted-foreground">Choose an active listing first. Prices are rechecked securely when you pay.</p>
        {loadError && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{loadError}</p>}
        <Button className="mt-5" asChild><Link href="/#new">Browse listings</Link></Button>
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

      {paymentError && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">{paymentError}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-5">
          <Card className="p-4">
            <h2 className="font-bold">Your items ({items.length})</h2>
            <div className="mt-3 flex flex-col gap-3">
              {items.map((item) => (
                <div key={item.product.id} className="flex items-center gap-3">
                  <div className="w-16 shrink-0 overflow-hidden rounded-xl border"><ProductArt hue={item.product.hue} category={item.product.category} className="aspect-square w-full" iconClassName="h-6 w-6" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.product.title}</p>
                    <p className="text-xs text-muted-foreground">Qty {item.qty} • {item.product.city}</p>
                  </div>
                  <p className="text-sm font-extrabold tabular-nums">{naira(item.product.price * item.qty)}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><MapPin className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h2 className="font-bold">Delivery address</h2><p className="text-xs text-muted-foreground">Saved securely to your buyer profile.</p></div><Button variant="link" size="sm" className="h-auto shrink-0 p-0" asChild><Link href="/account/addresses">Manage saved</Link></Button></div>
            <div className="mt-3 grid gap-3"><Input aria-label="Street address" placeholder="Street address" value={shipping.full_address} onChange={(event) => setShipping((current) => ({ ...current, full_address: event.target.value }))} /><div className="grid gap-3 sm:grid-cols-2"><Input aria-label="City" placeholder="City" value={shipping.city} onChange={(event) => setShipping((current) => ({ ...current, city: event.target.value }))} /><Input aria-label="Delivery phone" type="tel" placeholder="Phone" value={shipping.phone} onChange={(event) => setShipping((current) => ({ ...current, phone: event.target.value }))} /></div></div>
          </Card>

          <Card className="p-4">
            <h2 className="font-bold">Delivery method</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Delivery method">
              {DELIVERY.map((method) => (
                <button key={method.id} type="button" role="radio" aria-checked={delivery === method.id} onClick={() => setDelivery(method.id)} className={cn("flex items-center gap-3 rounded-xl border p-3 text-left transition", delivery === method.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50")}>
                  <method.icon className="h-5 w-5 shrink-0 text-primary" />
                  <span className="flex-1"><span className="block text-sm font-bold">{method.name}</span><span className="block text-xs text-muted-foreground">{method.eta}</span></span>
                  <span className="text-sm font-extrabold tabular-nums">{naira(method.fee)}</span>
                </button>
              ))}
            </div>
            <p className={cn("mt-2 text-[13px]", subsidy > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
              {subsidy > 0 ? `Launch promo: ${naira(subsidy)} delivery subsidy applied at checkout.` : "No delivery promotion is active for this order."}
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between"><h2 className="font-bold">Payment method</h2><Badge variant="outline">Secured by Paystack</Badge></div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Payment method">
              {PAY_METHODS.map((method) => (
                <button key={method.id} type="button" role="radio" aria-checked={payMethod === method.id} onClick={() => setPayMethod(method.id)} className={cn("flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition", payMethod === method.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50")}>
                  <method.icon className="h-5 w-5 text-primary" /><span className="text-sm font-bold">{method.name}</span><span className="text-xs text-muted-foreground">{method.sub}</span>
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
              <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="font-semibold tabular-nums">{naira(subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Delivery</dt><dd className="font-semibold tabular-nums">{naira(fee)}</dd></div>
              <div className="flex justify-between text-emerald-700 dark:text-emerald-300"><dt>Promo subsidy</dt><dd className="font-semibold tabular-nums">−{naira(subsidy)}</dd></div>
              <Separator />
              <div className="flex justify-between text-base"><dt className="font-bold">Total</dt><dd className="font-extrabold tabular-nums">{naira(total)}</dd></div>
            </dl>
            <Button size="lg" className="mt-4 w-full" onClick={pay} disabled={paymentState === "processing"}>
              {paymentState === "processing" ? <><Loader2 className="animate-spin" /> {live ? "Opening Paystack…" : "Processing payment…"}</> : <>Pay {naira(total)}</>}
            </Button>
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Held in escrow until you confirm delivery</p>
          </Card>
          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {live ? "You’ll leave Bale Drop for Paystack’s secure test checkout. We only show success after the signed webhook confirms payment." : "Demo mode: no payment leaves this browser."}</p>
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

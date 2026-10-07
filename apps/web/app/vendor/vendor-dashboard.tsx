"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, ImagePlus, Loader2, Pause, Play, Plus, PackageCheck, Truck, Users, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isSupabaseLive } from "@/lib/config";
import { friendlyErrorMessage } from "@/lib/errors";
import { naira } from "@/lib/format";
import { invokeOperation } from "@/lib/operations";
import { supabaseBrowser } from "@/lib/supabase";
import { CITIES } from "@/lib/taxonomy";
import type { Database } from "@bale-drop/database";

// Vendor listing categories exclude the storefront-only "All" chip.
const CATEGORIES = ["Bales", "Men", "Women", "Kids", "Shoes", "Bags", "Vintage"];
const STATUS_LABEL: Record<string, string> = { pending_payment: "Awaiting payment", paid: "Paid / escrow held", processing: "Processing", ready: "Ready to ship", in_transit: "In transit", delivered: "Delivered", disputed: "Dispute open" };

type ProductRow = Database["public"]["Tables"]["products"]["Row"];
type VendorRow = Database["public"]["Tables"]["vendor_profiles"]["Row"];
type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type ItemRow = Database["public"]["Tables"]["order_items"]["Row"];
type BaleRow = Database["public"]["Tables"]["bale_listings"]["Row"];
type PayoutRow = Database["public"]["Tables"]["vendor_payouts"]["Row"];

/** A live split plus the listing it belongs to, as the seller needs to see it. */
type SplitView = { bale: BaleRow; product: ProductRow | null };

const BALE_STATUS_LABEL: Record<string, string> = {
  open: "Open — buyers can join",
  full: "Full — ready to hand over",
  processing: "Settling",
  fulfilled: "Completed",
  expired: "Expired — slots refunded",
  cancelled: "Cancelled",
};

const PAYOUT_LABEL: Record<string, string> = {
  pending: "Queued",
  processing: "Transfer started",
  paid: "Paid",
  failed: "Failed — needs attention",
};

type FormState = { title: string; category: string; grade: "A" | "B" | "C"; kind: "single" | "bale"; price: string; qty: string; city: string; pieces: string; description: string };
const EMPTY_FORM: FormState = { title: "", category: "Bales", grade: "A", kind: "bale", price: "", qty: "1", city: "Lagos", pieces: "", description: "" };

export function VendorDashboard() {
  const live = isSupabaseLive();
  const [vendor, setVendor] = useState<VendorRow | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [orders, setOrders] = useState<(OrderRow & { title: string })[]>([]);
  const [splits, setSplits] = useState<SplitView[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [splitFor, setSplitFor] = useState<string | null>(null);
  const [splitForm, setSplitForm] = useState({ slots: "10", price: "", hours: "72" });
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [image, setImage] = useState<File | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(live);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [trackingNumbers, setTrackingNumbers] = useState<Record<string, string>>({});

  const load = useCallback(async (signal?: { cancelled: boolean }) => {
    const active = signal ? !signal.cancelled : true;
    if (!live) {
      setProducts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { setError("Sign in to view your seller dashboard."); setLoading(false); return; }
    const { data: vendorRow, error: vendorError } = await sb.from("vendor_profiles").select("*").eq("profile_id", user.id).maybeSingle();
    if (vendorError || !vendorRow) { setError(friendlyErrorMessage(vendorError ?? "Vendor profile not found", { context: "vendorDashboard" })); setLoading(false); return; }
    setVendor(vendorRow);
    const [{ data: productRows, error: productsError }, { data: orderRows, error: ordersError }] = await Promise.all([
      sb.from("products").select("*").eq("vendor_id", vendorRow.id).order("created_at", { ascending: false }),
      sb.from("orders").select("*").eq("vendor_id", vendorRow.id).order("created_at", { ascending: false }),
    ]);
    if (productsError || ordersError) setError(friendlyErrorMessage(productsError ?? ordersError, { context: "vendorDashboard" }));
    setProducts(productRows ?? []);
    const rawOrders = orderRows ?? [];
    const { data: items } = rawOrders.length ? await sb.from("order_items").select("*").in("order_id", rawOrders.map((row) => row.id)) : { data: [] as ItemRow[] };
    const firstItem = new Map<string, string>();
    for (const item of items ?? []) if (!firstItem.has(item.order_id)) firstItem.set(item.order_id, item.title_snapshot);
    setOrders(rawOrders.map((row) => ({ ...row, title: firstItem.get(row.id) ?? "Bale Drop order" })));

    // Splits and payouts are the seller's money view. `bale_listings` is public
    // read, so this is filtered by the products the seller owns.
    const productById = new Map((productRows ?? []).map((row) => [row.id, row]));
    const [{ data: baleRows }, { data: payoutRows }] = await Promise.all([
      sb.from("bale_listings").select("*").in("product_id", [...productById.keys()]).order("created_at", { ascending: false }),
      sb.from("vendor_payouts").select("*").eq("vendor_id", vendorRow.id).order("created_at", { ascending: false }).limit(25),
    ]);
    if (!active) return;
    setSplits((baleRows ?? []).map((bale) => ({ bale, product: productById.get(bale.product_id) ?? null })));
    setPayouts((payoutRows ?? []) as PayoutRow[]);
    setLoading(false);
  }, [live]);

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => { signal.cancelled = true; };
  }, [load]);

  /**
   * Vendor-visible numbers. A seller who can't see views/conversion cannot
   * improve a listing, and "why is nothing selling?" is the fastest way to lose
   * supply. Views come from the product row; the rest is derived from orders.
   */
  const stats = (() => {
    const active = products.filter((product) => product.status === "active").length;
    const pending = products.filter((product) => product.status === "pending").length;
    const views = products.reduce((sum, product) => sum + (product.views ?? 0), 0);
    const sold = products.reduce((sum, product) => sum + (product.sold_count ?? 0), 0);
    const revenue = orders
      .filter((order) => order.escrow_status !== "refunded" && order.status !== "cancelled")
      .reduce((sum, order) => sum + order.total_naira, 0);
    const awaiting = orders.filter((order) => order.status === "paid").length;
    return { active, pending, views, sold, revenue, awaiting };
  })();

  const canSubmitListings = vendor?.verification_status === "approved" || vendor?.verification_status === "inspected";

  const liveSplits = splits.filter((entry) => ["open", "full", "processing"].includes(entry.bale.status));

  /** Commission is 4% on the Pro plan and 7% otherwise (migration 0001). */
  const commissionPct = vendor?.subscription_plan === "pro" ? 4 : 7;

  const payoutTotals = payouts.reduce(
    (totals, payout) => {
      if (payout.status === "paid") totals.paid += payout.net_naira;
      else if (payout.status !== "failed") totals.pending += payout.net_naira;
      return totals;
    },
    { paid: 0, pending: 0 },
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) { setForm((current) => ({ ...current, [key]: value })); }

  async function createProduct() {
    setError(null); setNotice(null);
    if (!live) { setNotice("Listings cannot be submitted right now. Please try again later."); return; }
    if (!vendor) { setError("We couldn’t find your seller profile. Please refresh and try again."); return; }
    if (!canSubmitListings) { setError("Your seller account must be approved before you can submit listings. We’ll let you know once review is complete."); return; }
    if (form.title.trim().length < 4 || Number(form.price) <= 0) { setError("Add a title and a valid price."); return; }
    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const { data: product, error: productError } = await sb.from("products").insert({
        vendor_id: vendor.id,
        title: form.title.trim(), description: form.description.trim() || null,
        category: form.category, grade: form.grade, kind: form.kind,
        price_naira: Math.round(Number(form.price)), qty: Math.max(1, Math.round(Number(form.qty) || 1)),
        city: form.city, pieces_estimate: form.pieces.trim() || null, status: "pending",
      }).select("*").single();
      if (productError) throw productError;
      if (!product) throw new Error("Listing was not created. Please try again.");
      if (image) {
        const { data: { user } } = await sb.auth.getUser();
        if (user) {
          const path = `${user.id}/${product.id}-${image.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
          const { error: uploadError } = await sb.storage.from("product-images").upload(path, image, { upsert: false, cacheControl: "3600" });
          if (uploadError) throw uploadError;
          const { error: imageError } = await sb.from("product_images").insert({ product_id: product.id, storage_path: path, sort_order: 0 });
          if (imageError) throw imageError;
        }
      }
      setForm(EMPTY_FORM); setImage(null); setShowForm(false); setNotice("Listing submitted for admin moderation."); await load();
    } catch (caught) { setError(friendlyErrorMessage(caught, { context: "listing" })); }
    finally { setSaving(false); }
  }

  /**
   * Open a Bale Split on one of the seller's live bales.
   *
   * `create_bale_split()` (migration 0022) does the whole job in one
   * transaction: ownership, "listing must be live", "must be a full bale",
   * "no other live split", the total, the deadline and the seller notification.
   * Before it existed the only `bale_listings` row in the system came from
   * `seed.sql`, so the entire Bale Split product had no way to be created.
   */
  async function createSplit(productId: string) {
    setError(null); setNotice(null);
    const slots = Number(splitForm.slots);
    const price = Number(splitForm.price);
    const hours = Number(splitForm.hours);
    if (!Number.isInteger(slots) || slots < 2 || slots > 50) { setError("A split needs between 2 and 50 slots."); return; }
    if (!Number.isInteger(price) || price < 100) { setError("Each slot must be at least ₦100."); return; }
    if (!Number.isInteger(hours) || hours < 1 || hours > 336) { setError("The deadline must be between 1 hour and 14 days away."); return; }
    setBusy(`split-${productId}`);
    try {
      const sb = supabaseBrowser();
      const { data, error: rpcError } = await sb.rpc("create_bale_split", {
        p_product_id: productId,
        p_split_count: slots,
        p_price_per_slot_naira: price,
        p_expires_hours: hours,
      });
      if (rpcError) throw rpcError;
      const created = data as { total_naira?: number } | null;
      setSplitFor(null);
      setSplitForm({ slots: "10", price: "", hours: "72" });
      setNotice(`Split is live: ${slots} slots at ${naira(price)} each — ${naira(created?.total_naira ?? slots * price)} if it fills.`);
      await load();
    } catch (caught) {
      setError(friendlyErrorMessage(caught, { context: "listing" }));
    } finally {
      setBusy(null);
    }
  }

  /** Hand over a filled split: attributes the slot pay-ins, takes commission,
   * queues the payout. Without this the money from a filled split had no exit. */
  async function fulfilSplit(baleId: string) {
    setError(null); setNotice(null); setBusy(`fulfil-${baleId}`);
    const { error: actionError } = await invokeOperation(
      "split-action",
      { action: "fulfil", bale_id: baleId },
      { context: "orderAction" },
    );
    setBusy(null);
    if (actionError) { setError(actionError); return; }
    setNotice("Split settled. Your payout is queued for transfer.");
    await load();
  }

  /** Pull a split nobody has paid for yet. */
  async function cancelSplit(baleId: string) {
    setError(null); setNotice(null); setBusy(`cancel-${baleId}`);
    const { error: actionError } = await invokeOperation(
      "split-action",
      { action: "cancel", bale_id: baleId },
      { context: "orderAction" },
    );
    setBusy(null);
    if (actionError) { setError(actionError); return; }
    setNotice("Split cancelled. The listing is available to split again.");
    await load();
  }

  /** Pause / resume / resubmit a listing (`set_listing_status`, migration 0024). */
  async function setListingStatus(productId: string, status: "active" | "paused" | "pending") {
    setError(null); setNotice(null); setBusy(`status-${productId}`);
    try {
      const sb = supabaseBrowser();
      const { error: rpcError } = await sb.rpc("set_listing_status", { p_product_id: productId, p_status: status });
      if (rpcError) throw rpcError;
      setNotice(
        status === "paused" ? "Listing paused. Buyers can no longer see it."
          : status === "active" ? "Listing is live again."
            : "Listing resubmitted for moderation.",
      );
      await load();
    } catch (caught) {
      setError(friendlyErrorMessage(caught, { context: "listing" }));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Mark a dispatched order delivered. Since migration 0023 this stamps
   * `delivered_at` and starts the 48-hour escrow release window — it does not
   * pay the vendor. The buyer can still confirm early or open a dispute.
   */
  async function markDelivered(orderId: string) {
    setError(null); setNotice(null); setBusy(`delivered-${orderId}`);
    const { error: actionError } = await invokeOperation(
      "order-action",
      { action: "fulfillment_status", order_id: orderId, status: "delivered" },
      { context: "orderAction" },
    );
    setBusy(null);
    if (actionError) { setError(actionError); return; }
    setNotice("Marked delivered. The buyer has 48 hours to confirm or dispute before escrow releases automatically.");
    await load();
  }

  /**
   * Dispatch through the fulfillment adapter (`logistics-create`) instead of
   * typing a courier reference by hand.
   *
   * The function is idempotent on `dispatch-<order_id>`: a double click returns
   * the same tracking number rather than a second shipment, and it writes the
   * `fulfillment_events` row that the signed courier webhook later reconciles
   * against. Today the adapter mints a deterministic sandbox reference; swapping
   * in a real courier changes this button's output, not its contract.
   */
  async function createShipment(orderId: string) {
    setError(null); setNotice(null); setBusy(`ship-${orderId}`);
    const { data, error: actionError } = await invokeOperation<{
      tracking_number?: string;
      tracking_url?: string;
      duplicate?: boolean;
    }>("logistics-create", { order_id: orderId }, { context: "orderAction" });
    setBusy(null);
    if (actionError) { setError(actionError); return; }
    const number = data?.tracking_number ?? "";
    if (number) setTrackingNumbers((current) => ({ ...current, [orderId]: number }));
    setNotice(
      `${data?.duplicate ? "Shipment already existed" : "Shipment created"} — tracking ${number || "recorded"}. ` +
        "The order is in transit and the buyer can follow it.",
    );
    await load();
  }

  async function fulfil(orderId: string, status: "processing" | "ready" | "in_transit", trackingNumber?: string) {
    setError(null); setNotice(null);
    if (status === "in_transit" && !trackingNumber?.trim()) {
      setError("Enter the courier tracking number before dispatching.");
      return;
    }
    setBusy(`fulfil-${orderId}`);
    const { error: actionError } = await invokeOperation("order-action", { action: "fulfillment_status", order_id: orderId, status, tracking_number: trackingNumber?.trim() }, { context: "orderAction" });
    setBusy(null);
    if (actionError) { setError(actionError); return; }
    setNotice(status === "in_transit" ? "Order dispatched. The buyer can now track it." : "Order status updated.");
    await load();
  }


  return (
    <div className="container max-w-6xl py-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><Badge variant="inspected"><StoreIcon /> Vendor workspace</Badge><h1 className="mt-2 text-2xl font-extrabold tracking-tight">{vendor?.shop_name ?? "Sell on Bale Drop"}</h1><p className="mt-1 text-sm text-muted-foreground">Submit listings, dispatch orders and follow payout status.</p></div><Badge variant={vendor?.verification_status === "inspected" ? "verified" : "amber"}>{vendor?.verification_status ?? "Pending"}</Badge></div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</p>}

      {/* Seller KPIs — views, sell-through and money in escrow, not vanity counts. */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Live listings</p>
          <p className="text-xl font-extrabold tabular-nums break-words sm:text-2xl">{stats.active}</p>
          <p className="text-[11px] text-muted-foreground">{stats.pending} awaiting moderation</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Listing views</p>
          <p className="text-xl font-extrabold tabular-nums break-words sm:text-2xl">{stats.views.toLocaleString()}</p>
          <p className="text-[11px] text-muted-foreground">{stats.sold} units sold</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Order value</p>
          <p className="text-xl font-extrabold tabular-nums break-words sm:text-2xl">{naira(stats.revenue)}</p>
          <p className="text-[11px] text-muted-foreground">{orders.length} orders</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Action needed</p>
          <p className="text-xl font-extrabold tabular-nums break-words sm:text-2xl">{stats.awaiting}</p>
          <p className="text-[11px] text-muted-foreground">paid orders not yet started</p>
        </Card>
      </div>

      {stats.awaiting > 0 && (
        <p role="status" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/20">
          <b>{stats.awaiting}</b> paid order{stats.awaiting === 1 ? "" : "s"} waiting to be packed. Buyers see updates
          the moment you press <b>Start</b>.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.15fr]">
        <Card className="p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold">Your listings</h2><p className="text-xs text-muted-foreground">New listings enter admin moderation.</p></div><Button size="sm" onClick={() => { if (!vendor) { setError("We’re still loading your seller profile. Please try again in a moment."); return; } if (!canSubmitListings) { setError("Your seller account must be approved before you can submit listings. We’ll let you know once review is complete."); return; } setShowForm((value) => !value); }}><Plus /> New listing</Button></div>
          {showForm && <div className="mt-4 flex flex-col gap-3 border-t pt-4"><Input placeholder="Listing title" value={form.title} onChange={(e) => update("title", e.target.value)} /><div className="grid gap-3 sm:grid-cols-2"><select value={form.category} onChange={(e) => update("category", e.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm">{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select><select value={form.grade} onChange={(e) => update("grade", e.target.value as FormState["grade"])} className="h-11 rounded-xl border border-input bg-background px-3 text-sm"><option value="A">Grade A</option><option value="B">Grade B</option><option value="C">Grade C</option></select></div><div className="grid gap-3 sm:grid-cols-3"><select value={form.kind} onChange={(e) => update("kind", e.target.value as FormState["kind"])} className="h-11 rounded-xl border border-input bg-background px-3 text-sm"><option value="bale">Bale</option><option value="single">Single</option></select><Input inputMode="numeric" placeholder="Price in ₦" value={form.price} onChange={(e) => update("price", e.target.value.replace(/\D/g, ""))} /><Input inputMode="numeric" placeholder="Quantity" value={form.qty} onChange={(e) => update("qty", e.target.value.replace(/\D/g, ""))} /></div><div className="grid gap-3 sm:grid-cols-2"><select value={form.city} onChange={(e) => update("city", e.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm">{CITIES.map((city) => <option key={city}>{city}</option>)}</select><Input placeholder="Approx. pieces (e.g. ~60 pcs)" value={form.pieces} onChange={(e) => update("pieces", e.target.value)} /></div><Textarea placeholder="Describe grade, condition, sizing and what buyers receive" value={form.description} onChange={(e) => update("description", e.target.value)} /><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed p-3 text-sm"><ImagePlus className="h-4 w-4 text-primary" />{image?.name ?? "Add a listing photo"}<input type="file" accept="image/*" className="sr-only" onChange={(e) => setImage(e.target.files?.[0] ?? null)} /></label><Button onClick={createProduct} disabled={saving}>{saving ? <><Loader2 className="animate-spin" /> Saving…</> : "Submit for review"}</Button></div>}
          <div className="mt-4 flex flex-col divide-y">{loading ? <p className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></p> : products.length === 0 ? <div className="py-6 text-center"><p className="text-sm font-semibold">No listings yet</p><p className="mt-1 text-xs text-muted-foreground">Add your first bale or single piece. It goes live after moderation (usually under 24 hours).</p></div> : products.map((product) => {
            const split = splits.find((entry) => entry.bale.product_id === product.id);
            const splitLive = split ? ["open", "full", "processing"].includes(split.bale.status) : false;
            const canSplit = product.status === "active" && product.kind === "bale" && !splitLive;
            return (
              <div key={product.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><PackageCheck className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{product.title}</p>
                    <p className="text-xs text-muted-foreground">{product.category} • Grade {product.grade} • {naira(product.price_naira)}{product.qty > 1 ? ` • ${product.qty} in stock` : ""}</p>
                  </div>
                  <Badge variant={product.status === "active" ? "verified" : product.status === "rejected" ? "live" : "amber"}>{product.status}</Badge>
                </div>
                {live && (
                  <div className="flex flex-wrap items-center gap-2 pl-[52px]">
                    {canSplit && (
                      <Button size="sm" variant="outline" disabled={busy === `split-${product.id}`} onClick={() => { setSplitFor(splitFor === product.id ? null : product.id); setError(null); }}>
                        <Users className="h-4 w-4" /> Open a split
                      </Button>
                    )}
                    {product.status === "active" && (
                      <Button size="sm" variant="ghost" disabled={busy === `status-${product.id}`} onClick={() => setListingStatus(product.id, "paused")}>
                        <Pause className="h-4 w-4" /> Pause
                      </Button>
                    )}
                    {product.status === "paused" && (
                      <Button size="sm" variant="ghost" disabled={busy === `status-${product.id}`} onClick={() => setListingStatus(product.id, "active")}>
                        <Play className="h-4 w-4" /> Resume
                      </Button>
                    )}
                    {product.status === "rejected" && (
                      <Button size="sm" variant="ghost" disabled={busy === `status-${product.id}`} onClick={() => setListingStatus(product.id, "pending")}>
                        Resubmit for review
                      </Button>
                    )}
                    {product.status === "rejected" && vendor?.rejection_reason && (
                      <span className="text-xs text-muted-foreground">{vendor.rejection_reason}</span>
                    )}
                  </div>
                )}
                {splitFor === product.id && (
                  <div className="rounded-xl border bg-muted/40 p-3">
                    <p className="text-sm font-bold">Split this bale into slots</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Buyers pay per slot and the money is held in escrow. If the split does not fill by the
                      deadline, every paid slot is refunded automatically.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <label className="text-xs font-semibold text-muted-foreground">
                        Slots (2–50)
                        <Input className="mt-1" inputMode="numeric" value={splitForm.slots} onChange={(e) => setSplitForm((c) => ({ ...c, slots: e.target.value.replace(/\D/g, "").slice(0, 2) }))} />
                      </label>
                      <label className="text-xs font-semibold text-muted-foreground">
                        Price per slot (₦)
                        <Input className="mt-1" inputMode="numeric" placeholder={String(Math.round(product.price_naira / 10))} value={splitForm.price} onChange={(e) => setSplitForm((c) => ({ ...c, price: e.target.value.replace(/\D/g, "").slice(0, 9) }))} />
                      </label>
                      <label className="text-xs font-semibold text-muted-foreground">
                        Deadline (hours)
                        <Input className="mt-1" inputMode="numeric" value={splitForm.hours} onChange={(e) => setSplitForm((c) => ({ ...c, hours: e.target.value.replace(/\D/g, "").slice(0, 3) }))} />
                      </label>
                    </div>
                    {Number(splitForm.slots) >= 2 && Number(splitForm.price) >= 100 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        You receive <b className="text-foreground tabular-nums">{naira(Number(splitForm.slots) * Number(splitForm.price))}</b> if
                        all {splitForm.slots} slots are taken, less the platform commission.
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setSplitFor(null)}>Cancel</Button>
                      <Button size="sm" disabled={busy === `split-${product.id}`} onClick={() => createSplit(product.id)}>
                        {busy === `split-${product.id}` ? <Loader2 className="animate-spin" /> : <Check />} Make it live
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}</div>
        </Card>

        <Card className="p-5"><div><h2 className="font-bold">Orders to fulfill</h2><p className="text-xs text-muted-foreground">Only paid orders can move through dispatch. Marking an order delivered starts the buyer&rsquo;s 48-hour confirmation window.</p></div><div className="mt-4 flex flex-col divide-y">{loading ? <p className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></p> : orders.length === 0 ? <p className="py-6 text-sm text-muted-foreground">No live orders yet.</p> : orders.map((order) => <div key={order.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{order.title}</p><p className="text-xs text-muted-foreground">BD-{order.id.slice(0, 6).toUpperCase()} • {naira(order.total_naira)}{order.escrow_release_at ? ` • escrow releases ${new Date(order.escrow_release_at).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}` : ""}</p></div><Badge variant={order.status === "delivered" ? "verified" : order.status === "disputed" ? "live" : "amber"}>{STATUS_LABEL[order.status] ?? order.status}</Badge>{live && <div className="flex flex-wrap gap-2">{order.status === "paid" && <Button size="sm" onClick={() => fulfil(order.id, "processing")}>Start</Button>}{order.status === "processing" && <Button size="sm" onClick={() => fulfil(order.id, "ready")}>Ready</Button>}{order.status === "ready" && <><Input className="w-48" aria-label={`Tracking number for order ${order.id}`} placeholder="Courier tracking number" value={trackingNumbers[order.id] ?? ""} onChange={(e) => setTrackingNumbers((current) => ({ ...current, [order.id]: e.target.value }))} /><Button size="sm" disabled={!trackingNumbers[order.id]?.trim() || busy === `fulfil-${order.id}`} onClick={() => fulfil(order.id, "in_transit", trackingNumbers[order.id])}>{busy === `fulfil-${order.id}` ? <Loader2 className="animate-spin" /> : <Truck />} Mark dispatched</Button><Button size="sm" variant="outline" disabled={busy === `ship-${order.id}`} onClick={() => createShipment(order.id)} title="Creates a Bale Drop sandbox tracking number and dispatches the order">{busy === `ship-${order.id}` ? <Loader2 className="animate-spin" /> : <PackageCheck />} Dispatch with Bale Drop tracking</Button></>}{order.status === "in_transit" && <Button size="sm" variant="outline" disabled={busy === `delivered-${order.id}`} onClick={() => markDelivered(order.id)}><Check className="h-4 w-4" /> Mark delivered</Button>}</div>}</div>)}</div></Card>
      </div>

      {/* Bale Splits — the group-buy product. Sellers open a split from a live
          bale listing, watch it fill, then hand it over to settle the money. */}
      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold">Bale Splits</h2>
            <p className="text-xs text-muted-foreground">
              Slot money is held in escrow. Unfilled splits refund every buyer automatically at the deadline.
            </p>
          </div>
          <Badge variant={liveSplits.length > 0 ? "live" : "default"}>
            {liveSplits.length} live • {splits.length} total
          </Badge>
        </div>

        {splits.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No splits yet. Open one from a live bale listing above — buyers join with
            {" "}{naira(1000)} slots instead of paying for a whole bale.
          </p>
        ) : (
          <div className="mt-4 flex flex-col divide-y">
            {splits.map(({ bale, product }) => {
              const left = Math.max(0, bale.split_count - bale.booked_count);
              const filled = bale.booked_count >= bale.split_count;
              const pct = Math.min(100, Math.round((bale.booked_count / Math.max(1, bale.split_count)) * 100));
              const expired = Date.parse(bale.expires_at) < Date.now();
              const canFulfil = (bale.status === "full" || (bale.status === "open" && filled)) && !expired;
              const canCancel = bale.status === "open" && bale.booked_count === 0;
              return (
                <div key={bale.id} className="flex flex-col gap-3 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Users className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{product?.title ?? "Bale listing"}</p>
                      <p className="text-xs text-muted-foreground">
                        {bale.booked_count}/{bale.split_count} slots at {naira(bale.price_per_slot_naira)} •{" "}
                        <span className="tabular-nums">{naira(bale.total_naira)}</span> if it fills
                      </p>
                    </div>
                    <Badge variant={bale.status === "fulfilled" ? "verified" : bale.status === "expired" || bale.status === "cancelled" ? "live" : "amber"}>
                      {BALE_STATUS_LABEL[bale.status] ?? bale.status}
                    </Badge>
                  </div>

                  <div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={bale.booked_count} aria-valuemin={0} aria-valuemax={bale.split_count} aria-label="Slots taken">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {expired || ["fulfilled", "expired", "cancelled"].includes(bale.status)
                        ? `Closed ${new Date(bale.expires_at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                        : `Closes ${new Date(bale.expires_at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} • ${left} slot${left === 1 ? "" : "s"} left`}
                      {product && <span>• <Link className="font-semibold hover:text-primary hover:underline" href={`/listing/${product.id}`}>View listing</Link></span>}
                    </p>
                  </div>

                  {live && (canFulfil || canCancel) && (
                    <div className="flex flex-wrap gap-2">
                      {canFulfil && (
                        <Button size="sm" disabled={busy === `fulfil-${bale.id}`} onClick={() => fulfilSplit(bale.id)}>
                          {busy === `fulfil-${bale.id}` ? <Loader2 className="animate-spin" /> : <Check />} Mark handed over &amp; settle
                        </Button>
                      )}
                      {canCancel && (
                        <Button size="sm" variant="ghost" disabled={busy === `cancel-${bale.id}`} onClick={() => cancelSplit(bale.id)}>
                          {busy === `cancel-${bale.id}` ? <Loader2 className="animate-spin" /> : <XCircle className="h-4 w-4" />} Cancel split
                        </Button>
                      )}
                    </div>
                  )}
                  {live && bale.status === "open" && !filled && !expired && (
                    <p className="text-xs text-muted-foreground">
                      You can only settle once every slot is paid. Cancel is available while nobody has paid.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Payout statement — gross, commission, net and where each one is. */}
      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold">Payouts</h2>
            <p className="text-xs text-muted-foreground">
              Commission is {commissionPct}% of the order subtotal{vendor?.subscription_plan === "pro" ? " (Pro plan)" : ""}. Standard plan pays 7%.
            </p>
          </div>
          <Badge variant="default">
            {naira(payoutTotals.paid)} paid • {naira(payoutTotals.pending)} pending
          </Badge>
        </div>

        {payouts.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No payouts yet. A payout is queued as soon as a buyer confirms delivery
            or a split is settled.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <caption className="sr-only">Your payout history</caption>
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-semibold">When</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Gross</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Commission</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Net</th>
                  <th scope="col" className="py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((payout) => (
                  <tr key={payout.id} className="border-b last:border-0">
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                      {new Date(payout.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                      {payout.order_id ? <span className="block font-mono text-[11px]">BD-{payout.order_id.slice(0, 6).toUpperCase()}</span> : <span className="block font-mono text-[11px]">Split settlement</span>}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">{naira(payout.gross_naira)}</td>
                    <td className="py-2.5 pr-3 tabular-nums text-muted-foreground">−{naira(payout.commission_naira)}</td>
                    <td className="py-2.5 pr-3 font-semibold tabular-nums">{naira(payout.net_naira)}</td>
                    <td className="py-2.5">
                      <Badge variant={payout.status === "paid" ? "verified" : payout.status === "failed" ? "live" : "amber"}>
                        {PAYOUT_LABEL[payout.status] ?? payout.status}
                      </Badge>
                      {payout.status === "failed" && payout.last_error && (
                        <span className="mt-1 block text-[11px] text-muted-foreground">{payout.last_error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function StoreIcon() { return <PackageCheck className="h-3.5 w-3.5" />; }

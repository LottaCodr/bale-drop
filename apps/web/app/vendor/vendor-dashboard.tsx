"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ImagePlus, Loader2, PackageCheck, Plus, Truck } from "lucide-react";
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

type FormState = { title: string; category: string; grade: "A" | "B" | "C"; kind: "single" | "bale"; price: string; qty: string; city: string; pieces: string; description: string };
const EMPTY_FORM: FormState = { title: "", category: "Bales", grade: "A", kind: "bale", price: "", qty: "1", city: "Lagos", pieces: "", description: "" };

export function VendorDashboard() {
  const live = isSupabaseLive();
  const [vendor, setVendor] = useState<VendorRow | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [orders, setOrders] = useState<(OrderRow & { title: string })[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [image, setImage] = useState<File | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(live);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [trackingNumbers, setTrackingNumbers] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
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
    setLoading(false);
  }, [live]);

  useEffect(() => { void load(); }, [load]);

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

  async function fulfil(orderId: string, status: "processing" | "ready" | "in_transit", trackingNumber?: string) {
    setError(null); setNotice(null);
    if (status === "in_transit" && !trackingNumber?.trim()) {
      setError("Enter the courier tracking number before dispatching.");
      return;
    }
    const { error: actionError } = await invokeOperation("order-action", { action: "fulfillment_status", order_id: orderId, status, tracking_number: trackingNumber?.trim() }, { context: "orderAction" });
    if (actionError) { setError(actionError); return; }
    setNotice("Order status updated."); await load();
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
          <p className="text-2xl font-extrabold tabular-nums">{stats.active}</p>
          <p className="text-[11px] text-muted-foreground">{stats.pending} awaiting moderation</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Listing views</p>
          <p className="text-2xl font-extrabold tabular-nums">{stats.views.toLocaleString()}</p>
          <p className="text-[11px] text-muted-foreground">{stats.sold} units sold</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Order value</p>
          <p className="text-2xl font-extrabold tabular-nums">{naira(stats.revenue)}</p>
          <p className="text-[11px] text-muted-foreground">{orders.length} orders</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Action needed</p>
          <p className="text-2xl font-extrabold tabular-nums">{stats.awaiting}</p>
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
        <Card className="p-5"><div className="flex items-center justify-between gap-2"><div><h2 className="font-bold">Your listings</h2><p className="text-xs text-muted-foreground">New listings enter admin moderation.</p></div><Button size="sm" onClick={() => { if (!vendor) { setError("We’re still loading your seller profile. Please try again in a moment."); return; } if (!canSubmitListings) { setError("Your seller account must be approved before you can submit listings. We’ll let you know once review is complete."); return; } setShowForm((value) => !value); }}><Plus /> New listing</Button></div>
          {showForm && <div className="mt-4 flex flex-col gap-3 border-t pt-4"><Input placeholder="Listing title" value={form.title} onChange={(e) => update("title", e.target.value)} /><div className="grid gap-3 sm:grid-cols-2"><select value={form.category} onChange={(e) => update("category", e.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm">{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select><select value={form.grade} onChange={(e) => update("grade", e.target.value as FormState["grade"])} className="h-11 rounded-xl border border-input bg-background px-3 text-sm"><option value="A">Grade A</option><option value="B">Grade B</option><option value="C">Grade C</option></select></div><div className="grid gap-3 sm:grid-cols-3"><select value={form.kind} onChange={(e) => update("kind", e.target.value as FormState["kind"])} className="h-11 rounded-xl border border-input bg-background px-3 text-sm"><option value="bale">Bale</option><option value="single">Single</option></select><Input inputMode="numeric" placeholder="Price in ₦" value={form.price} onChange={(e) => update("price", e.target.value.replace(/\D/g, ""))} /><Input inputMode="numeric" placeholder="Quantity" value={form.qty} onChange={(e) => update("qty", e.target.value.replace(/\D/g, ""))} /></div><div className="grid gap-3 sm:grid-cols-2"><select value={form.city} onChange={(e) => update("city", e.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm">{CITIES.map((city) => <option key={city}>{city}</option>)}</select><Input placeholder="Approx. pieces (e.g. ~60 pcs)" value={form.pieces} onChange={(e) => update("pieces", e.target.value)} /></div><Textarea placeholder="Describe grade, condition, sizing and what buyers receive" value={form.description} onChange={(e) => update("description", e.target.value)} /><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed p-3 text-sm"><ImagePlus className="h-4 w-4 text-primary" />{image?.name ?? "Add a listing photo"}<input type="file" accept="image/*" className="sr-only" onChange={(e) => setImage(e.target.files?.[0] ?? null)} /></label><Button onClick={createProduct} disabled={saving}>{saving ? <><Loader2 className="animate-spin" /> Saving…</> : "Submit for review"}</Button></div>}
          <div className="mt-4 flex flex-col divide-y">{loading ? <p className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></p> : products.length === 0 ? <div className="py-6 text-center"><p className="text-sm font-semibold">No listings yet</p><p className="mt-1 text-xs text-muted-foreground">Add your first bale or single piece. It goes live after moderation (usually under 24 hours).</p></div> : products.map((product) => <div key={product.id} className="flex items-center gap-3 py-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><PackageCheck className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{product.title}</p><p className="text-xs text-muted-foreground">{product.category} • Grade {product.grade} • {naira(product.price_naira)}</p></div><Badge variant={product.status === "active" ? "verified" : product.status === "rejected" ? "live" : "amber"}>{product.status}</Badge></div>)}</div>
        </Card>

        <Card className="p-5"><div><h2 className="font-bold">Orders to fulfill</h2><p className="text-xs text-muted-foreground">Only paid orders can move through dispatch.</p></div><div className="mt-4 flex flex-col divide-y">{loading ? <p className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></p> : orders.length === 0 ? <p className="py-6 text-sm text-muted-foreground">No live orders yet.</p> : orders.map((order) => <div key={order.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{order.title}</p><p className="text-xs text-muted-foreground">BD-{order.id.slice(0, 6).toUpperCase()} • {naira(order.total_naira)}</p></div><Badge variant={order.status === "delivered" ? "verified" : order.status === "disputed" ? "live" : "amber"}>{STATUS_LABEL[order.status] ?? order.status}</Badge>{live && <div className="flex flex-wrap gap-2">{order.status === "paid" && <Button size="sm" onClick={() => fulfil(order.id, "processing")}>Start</Button>}{order.status === "processing" && <Button size="sm" onClick={() => fulfil(order.id, "ready")}>Ready</Button>}{order.status === "ready" && <><Input className="w-48" aria-label={`Tracking number for order ${order.id}`} placeholder="Courier tracking number" value={trackingNumbers[order.id] ?? ""} onChange={(e) => setTrackingNumbers((current) => ({ ...current, [order.id]: e.target.value }))} /><Button size="sm" disabled={!trackingNumbers[order.id]?.trim()} onClick={() => fulfil(order.id, "in_transit", trackingNumbers[order.id])}><Truck /> Mark dispatched</Button></>}</div>}</div>)}</div></Card>
      </div>
    </div>
  );
}

function StoreIcon() { return <PackageCheck className="h-3.5 w-3.5" />; }

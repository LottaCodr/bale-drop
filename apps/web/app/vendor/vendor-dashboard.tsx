"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ImagePlus, Loader2, PackageCheck, Plus, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isSupabaseLive } from "@/lib/config";
import { naira } from "@/lib/format";
import { invokeOperation } from "@/lib/operations";
import { supabaseBrowser } from "@/lib/supabase";
import { CITIES, PRODUCTS } from "@/lib/mock";
import type { Database } from "@bale-drop/database";

const CATEGORIES = ["Bales", "Men", "Women", "Kids", "Shoes", "Bags", "Vintage"];
const STATUS_LABEL: Record<string, string> = { pending_payment: "Awaiting payment", paid: "Paid / escrow held", processing: "Processing", ready: "Ready to ship", in_transit: "In transit", delivered: "Delivered", disputed: "Dispute open" };

type ProductRow = Database["public"]["Tables"]["products"]["Row"];
type VendorRow = Database["public"]["Tables"]["vendor_profiles"]["Row"];
type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type ItemRow = Database["public"]["Tables"]["order_items"]["Row"];

type FormState = { title: string; category: string; grade: "A" | "B" | "C"; kind: "single" | "bale"; price: string; qty: string; city: string; pieces: string; description: string };
const EMPTY_FORM: FormState = { title: "", category: "Bales", grade: "A", kind: "bale", price: "", qty: "1", city: "Lagos", pieces: "", description: "" };

export function VendorDashboard({ demo }: { demo: boolean }) {
  const live = isSupabaseLive() && !demo;
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

  const load = useCallback(async () => {
    if (!live) {
      setProducts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { setError("Sign in required"); setLoading(false); return; }
    const { data: vendorRow, error: vendorError } = await sb.from("vendor_profiles").select("*").eq("profile_id", user.id).maybeSingle();
    if (vendorError || !vendorRow) { setError(vendorError?.message ?? "Vendor profile not found"); setLoading(false); return; }
    setVendor(vendorRow);
    const [{ data: productRows, error: productsError }, { data: orderRows, error: ordersError }] = await Promise.all([
      sb.from("products").select("*").eq("vendor_id", vendorRow.id).order("created_at", { ascending: false }),
      sb.from("orders").select("*").eq("vendor_id", vendorRow.id).order("created_at", { ascending: false }),
    ]);
    if (productsError || ordersError) setError(productsError?.message ?? ordersError?.message ?? "Could not load dashboard");
    setProducts(productRows ?? []);
    const rawOrders = orderRows ?? [];
    const { data: items } = rawOrders.length ? await sb.from("order_items").select("*").in("order_id", rawOrders.map((row) => row.id)) : { data: [] as ItemRow[] };
    const firstItem = new Map<string, string>();
    for (const item of items ?? []) if (!firstItem.has(item.order_id)) firstItem.set(item.order_id, item.title_snapshot);
    setOrders(rawOrders.map((row) => ({ ...row, title: firstItem.get(row.id) ?? "Bale Drop order" })));
    setLoading(false);
  }, [live]);

  useEffect(() => { void load(); }, [load]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) { setForm((current) => ({ ...current, [key]: value })); }

  async function createProduct() {
    setError(null); setNotice(null);
    if (!live) { setNotice("Demo preview: connect Supabase to submit this listing."); return; }
    if (!vendor || form.title.trim().length < 4 || Number(form.price) <= 0) { setError("Add a title and a valid price."); return; }
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
      if (productError || !product) throw new Error(productError?.message ?? "Could not create listing");
      if (image) {
        const { data: { user } } = await sb.auth.getUser();
        if (user) {
          const path = `${user.id}/${product.id}-${image.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
          const { error: uploadError } = await sb.storage.from("product-images").upload(path, image, { upsert: false, cacheControl: "3600" });
          if (uploadError) throw new Error(uploadError.message);
          const { error: imageError } = await sb.from("product_images").insert({ product_id: product.id, storage_path: path, sort_order: 0 });
          if (imageError) throw new Error(imageError.message);
        }
      }
      setForm(EMPTY_FORM); setImage(null); setShowForm(false); setNotice("Listing submitted for admin moderation."); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create listing"); }
    finally { setSaving(false); }
  }

  async function fulfil(orderId: string, status: "processing" | "ready" | "in_transit") {
    setError(null); setNotice(null);
    const { error: actionError } = await invokeOperation("order-action", { action: "fulfillment_status", order_id: orderId, status, tracking_number: status === "in_transit" ? `BDX-${orderId.slice(0, 8).toUpperCase()}` : undefined, tracking_url: status === "in_transit" ? `https://track.baledrop.demo/BDX-${orderId.slice(0, 8).toUpperCase()}` : undefined });
    if (actionError) { setError(actionError); return; }
    setNotice("Order status updated."); await load();
  }

  async function createTracking(orderId: string) {
    const { error: actionError } = await invokeOperation("logistics-create", { order_id: orderId, provider: "bale_drop_sandbox" });
    if (actionError) { setError(actionError); return; }
    setNotice("Sandbox tracking created."); await load();
  }

  const demoProducts = PRODUCTS.slice(0, 4);
  const visibleProducts = live ? products : demoProducts.map((product) => ({ id: product.id, title: product.title, status: "active", price_naira: product.price, category: product.category, grade: product.grade, kind: product.isBale ? "bale" : "single", qty: 1 } as unknown as ProductRow));

  return (
    <div className="container max-w-6xl py-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><Badge variant="inspected"><StoreIcon /> Vendor workspace</Badge><h1 className="mt-2 text-2xl font-extrabold tracking-tight">{vendor?.shop_name ?? "Sell on Bale Drop"}</h1><p className="mt-1 text-sm text-muted-foreground">Submit listings, dispatch orders and follow payout status.</p></div><Badge variant={vendor?.verification_status === "inspected" ? "verified" : "amber"}>{vendor?.verification_status ?? "Demo preview"}</Badge></div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4"><Card className="p-4"><p className="text-xs text-muted-foreground">Listings</p><p className="text-2xl font-extrabold">{visibleProducts.length}</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">Live / pending</p><p className="text-2xl font-extrabold">{visibleProducts.filter((p) => p.status === "active").length} / {visibleProducts.filter((p) => p.status === "pending").length}</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">Orders</p><p className="text-2xl font-extrabold">{orders.length}</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">Payouts</p><p className="text-sm font-bold">After delivery confirmation</p></Card></div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.15fr]">
        <Card className="p-5"><div className="flex items-center justify-between gap-2"><div><h2 className="font-bold">Your listings</h2><p className="text-xs text-muted-foreground">New listings enter admin moderation.</p></div><Button size="sm" onClick={() => setShowForm((value) => !value)}><Plus /> New listing</Button></div>
          {showForm && <div className="mt-4 flex flex-col gap-3 border-t pt-4"><Input placeholder="Listing title" value={form.title} onChange={(e) => update("title", e.target.value)} /><div className="grid gap-3 sm:grid-cols-2"><select value={form.category} onChange={(e) => update("category", e.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm">{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select><select value={form.grade} onChange={(e) => update("grade", e.target.value as FormState["grade"])} className="h-11 rounded-xl border border-input bg-background px-3 text-sm"><option value="A">Grade A</option><option value="B">Grade B</option><option value="C">Grade C</option></select></div><div className="grid gap-3 sm:grid-cols-3"><select value={form.kind} onChange={(e) => update("kind", e.target.value as FormState["kind"])} className="h-11 rounded-xl border border-input bg-background px-3 text-sm"><option value="bale">Bale</option><option value="single">Single</option></select><Input inputMode="numeric" placeholder="Price in ₦" value={form.price} onChange={(e) => update("price", e.target.value.replace(/\D/g, ""))} /><Input inputMode="numeric" placeholder="Quantity" value={form.qty} onChange={(e) => update("qty", e.target.value.replace(/\D/g, ""))} /></div><div className="grid gap-3 sm:grid-cols-2"><select value={form.city} onChange={(e) => update("city", e.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm">{CITIES.map((city) => <option key={city}>{city}</option>)}</select><Input placeholder="Approx. pieces (e.g. ~60 pcs)" value={form.pieces} onChange={(e) => update("pieces", e.target.value)} /></div><Textarea placeholder="Describe grade, condition, sizing and what buyers receive" value={form.description} onChange={(e) => update("description", e.target.value)} /><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed p-3 text-sm"><ImagePlus className="h-4 w-4 text-primary" />{image?.name ?? "Add a listing photo"}<input type="file" accept="image/*" className="sr-only" onChange={(e) => setImage(e.target.files?.[0] ?? null)} /></label><Button onClick={createProduct} disabled={saving}>{saving ? <><Loader2 className="animate-spin" /> Saving…</> : "Submit for review"}</Button></div>}
          <div className="mt-4 flex flex-col divide-y">{loading ? <p className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></p> : visibleProducts.map((product) => <div key={product.id} className="flex items-center gap-3 py-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><PackageCheck className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{product.title}</p><p className="text-xs text-muted-foreground">{product.category} • Grade {product.grade} • {naira(product.price_naira)}</p></div><Badge variant={product.status === "active" ? "verified" : product.status === "rejected" ? "live" : "amber"}>{product.status}</Badge></div>)}</div>
        </Card>

        <Card className="p-5"><div><h2 className="font-bold">Orders to fulfill</h2><p className="text-xs text-muted-foreground">Only paid orders can move through dispatch.</p></div><div className="mt-4 flex flex-col divide-y">{loading ? <p className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></p> : orders.length === 0 ? <p className="py-6 text-sm text-muted-foreground">No live orders yet.</p> : orders.map((order) => <div key={order.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{order.title}</p><p className="text-xs text-muted-foreground">BD-{order.id.slice(0, 6).toUpperCase()} • {naira(order.total_naira)}</p></div><Badge variant={order.status === "delivered" ? "verified" : order.status === "disputed" ? "live" : "amber"}>{STATUS_LABEL[order.status] ?? order.status}</Badge>{live && <div className="flex flex-wrap gap-2">{order.status === "paid" && <Button size="sm" onClick={() => fulfil(order.id, "processing")}>Start</Button>}{order.status === "processing" && <Button size="sm" onClick={() => fulfil(order.id, "ready")}>Ready</Button>}{order.status === "ready" && <Button size="sm" onClick={() => createTracking(order.id)}><Truck /> Dispatch</Button>}</div>}</div>)}</div></Card>
      </div>
    </div>
  );
}

function StoreIcon() { return <PackageCheck className="h-3.5 w-3.5" />; }
